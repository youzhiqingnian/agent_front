<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  chatWithCs,
  chatWithCsStream,
  clearCsCache,
  clearUserQaHistory,
  deleteUserQaRecord,
  fetchCsCacheStats,
  fetchUserQaHistory,
  fetchUserQaSessions,
} from '../api'
import { authStore } from '../store/auth'

const STORAGE_KEY = 'cs-chat-session'

const AGENT_LABELS = {
  text_to_sql_agent: '📊 数据查询专员',
  order_agent: '订单专员',
  product_agent: '商品咨询',
  aftersale_agent: '售后专员',
  chitchat_agent: '通用客服',
  security_guard: '安全风控',
  clarification_agent: '信息澄清',
  semantic_cache: '⚡ 语义缓存',
}

const MODE_LABELS = {
  sql: '📊 SQL直查汇总',
  llm: '大模型',
  rule: '规则兜底',
  cache: '⚡ 缓存命中',
}

const cacheStats = ref(null)

const messages = ref([])
const conversationId = ref('')
const input = ref('')
const sending = ref(false)
const composing = ref(false)
const error = ref('')
const listEl = ref(null)
const openTrace = ref(-1)

let activeTypewriterTimer = null

// 个人历史问答弹窗相关状态（按登录账号完全隔离）
const showHistoryModal = ref(false)
const historyLoading = ref(false)
const historyRecords = ref([])
const historyTotal = ref(0)
const historyKeyword = ref('')
const userSessions = ref([])
const selectedSessionId = ref('')

const canSend = computed(() => !sending.value)

function greeting() {
  return [
    {
      role: 'assistant',
      content: '您好，我是易学商城智能客服～\n可以帮您解答订单查询、商品咨询、售后等问题，请直接输入您的问题。',
    },
  ]
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved && Array.isArray(saved.messages) && saved.messages.length) {
      conversationId.value = saved.conversationId || ''
      messages.value = saved.messages
      return
    }
  } catch {
    // 本地存储损坏时忽略，重新开始
  }
  messages.value = greeting()
}

function saveSession() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ conversationId: conversationId.value, messages: messages.value }),
  )
}

function scrollToBottom() {
  nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function resetSession() {
  if (activeTypewriterTimer) {
    clearInterval(activeTypewriterTimer)
    activeTypewriterTimer = null
  }
  localStorage.removeItem(STORAGE_KEY)
  conversationId.value = ''
  messages.value = greeting()
  openTrace.value = -1
  error.value = ''
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value) return
  input.value = ''
  error.value = ''

  // 1. 用户提问消息即刻入列
  messages.value.push({ role: 'user', content: text })
  sending.value = true

  // 2. 助理气泡即刻入列（包含深度思考推理卡片与平滑打字机状态）
  const assistantMsg = {
    role: 'assistant',
    content: '',
    agent: '',
    mode: '',
    trace: [],
    thoughts: [],
    thinking: true,
    thinkingText: '',
    thinkingTyping: false,
    typing: false,
  }
  messages.value.push(assistantMsg)
  scrollToBottom()

  // 全链路双轨打字机：思考推理流逐字向外蹦 + 回答正文逐字向外蹦 (12ms 高频时钟)
  let thoughtCharBuffer = ''
  let tokenBuffer = ''
  let typewriterTimer = null
  let isStreamDone = false
  let pendingDoneEvt = null

  const flushTypewriter = () => {
    let hasWork = false

    // 1. 驱动思考推理流逐字向外蹦 (Typewriter for Thinking stream)
    if (thoughtCharBuffer.length > 0) {
      hasWork = true
      const step = thoughtCharBuffer.length > 35 ? 3 : thoughtCharBuffer.length > 15 ? 2 : 1
      const chars = thoughtCharBuffer.slice(0, step)
      thoughtCharBuffer = thoughtCharBuffer.slice(step)
      assistantMsg.thinkingText += chars
      assistantMsg.thinkingTyping = true
    } else {
      assistantMsg.thinkingTyping = false
    }

    // 2. 驱动回答正文逐字向外蹦 (Typewriter for Answer content)
    if (tokenBuffer.length > 0) {
      hasWork = true
      const step = tokenBuffer.length > 30 ? 3 : tokenBuffer.length > 10 ? 2 : 1
      const chars = tokenBuffer.slice(0, step)
      tokenBuffer = tokenBuffer.slice(step)
      assistantMsg.content += chars
      assistantMsg.typing = true
    }

    if (hasWork) {
      scrollToBottom()
    } else if (isStreamDone) {
      // 流全部结束且全部打字缓冲区均已排空
      if (typewriterTimer) {
        clearInterval(typewriterTimer)
        typewriterTimer = null
      }
      activeTypewriterTimer = null
      assistantMsg.thinkingTyping = false
      assistantMsg.typing = false
      assistantMsg.thinking = false
      if (!assistantMsg.content && pendingDoneEvt?.reply) {
        assistantMsg.content = pendingDoneEvt.reply
      }
      scrollToBottom()
    }
  }

  const startTypewriter = () => {
    if (!typewriterTimer) {
      typewriterTimer = setInterval(flushTypewriter, 12)
      activeTypewriterTimer = typewriterTimer
    }
  }

  try {
    await chatWithCsStream(conversationId.value, text, {
      onThought: (th) => {
        // 保存 thought 结构化记录
        const existingIdx = assistantMsg.thoughts.findIndex((t) => t.node === th.node)
        if (existingIdx >= 0) {
          assistantMsg.thoughts[existingIdx] = {
            ...assistantMsg.thoughts[existingIdx],
            title: th.title,
            detail: th.detail,
            status: th.status,
          }
        } else {
          assistantMsg.thoughts.push({
            node: th.node,
            title: th.title,
            detail: th.detail,
            status: th.status,
          })
        }

        // 生成思考推理流日志行并推入打字机字符队列
        const marker = th.status === 'running' ? '▸' : '✓'
        const detailText = th.detail ? ` — ${th.detail}` : ''
        const line = `${marker} ${th.title}${detailText}\n`
        thoughtCharBuffer += line

        startTypewriter()
        scrollToBottom()
      },
      onToken: (tok) => {
        // 首字到达：思考主要阶段已完成，开启正文打字机
        if (assistantMsg.thinking) {
          assistantMsg.thinking = false
        }
        assistantMsg.typing = true
        tokenBuffer += tok.content
        startTypewriter()
      },
      onDone: (doneEvt) => {
        isStreamDone = true
        pendingDoneEvt = doneEvt
        assistantMsg.agent = doneEvt.agent
        assistantMsg.mode = doneEvt.mode
        assistantMsg.trace = doneEvt.trace || []
        conversationId.value = doneEvt.conversation_id
        startTypewriter()
      },
      onError: (errEvt) => {
        assistantMsg.thinking = false
        assistantMsg.thinkingTyping = false
        assistantMsg.typing = false
        if (typewriterTimer) {
          clearInterval(typewriterTimer)
          typewriterTimer = null
        }
        activeTypewriterTimer = null
        error.value = errEvt.message || '接收回复异常'
      },
    })
  } catch (err) {
    assistantMsg.thinking = false
    assistantMsg.thinkingTyping = false
    assistantMsg.typing = false
    if (typewriterTimer) {
      clearInterval(typewriterTimer)
      typewriterTimer = null
    }
    activeTypewriterTimer = null
    error.value = err.message || '消息发送失败'
    if (!assistantMsg.content) {
      assistantMsg.content = '抱歉，服务暂不可用，请稍后重试。'
      assistantMsg.failed = true
    }
  } finally {
    sending.value = false
    scrollToBottom()
    refreshCacheStats()
    if (authStore.isAuthenticated.value) {
      loadHistoryData()
    }
  }
}

async function refreshCacheStats() {
  try {
    cacheStats.value = await fetchCsCacheStats()
  } catch {
    // 忽略异常
  }
}

async function handleClearCache() {
  if (!confirm('确定要清空 Redis 语义缓存吗？清空后将重新从大模型问答沉淀。')) return
  try {
    await clearCsCache()
    await refreshCacheStats()
  } catch (e) {
    alert(e.message || '清空缓存失败')
  }
}

// ===== 个人历史问答业务处理 =====

async function openHistory() {
  if (!authStore.isAuthenticated.value) {
    authStore.openLogin()
    return
  }
  showHistoryModal.value = true
  await loadHistoryData()
}

async function loadHistoryData() {
  if (!authStore.isAuthenticated.value) {
    historyRecords.value = []
    historyTotal.value = 0
    userSessions.value = []
    return
  }
  historyLoading.value = true
  try {
    const res = await fetchUserQaHistory({
      keyword: historyKeyword.value.trim(),
      conversation_id: selectedSessionId.value,
    })
    historyRecords.value = res.items || []
    historyTotal.value = res.total || 0

    // 同时拉取会话分组
    const sessions = await fetchUserQaSessions()
    userSessions.value = sessions || []
  } catch (err) {
    console.error('获取个人历史问答失败:', err)
  } finally {
    historyLoading.value = false
  }
}

async function handleDeleteHistoryItem(id) {
  if (!confirm('确定要删除这条提问与解答记录吗？')) return
  try {
    await deleteUserQaRecord(id)
    await loadHistoryData()
  } catch (err) {
    alert(err.message || '删除记录失败')
  }
}

async function handleClearAllUserHistory() {
  if (!confirm('确定要清空您在此账号下的所有提问与解答记录吗？此操作不可恢复。')) return
  try {
    await clearUserQaHistory()
    await loadHistoryData()
  } catch (err) {
    alert(err.message || '清空记录失败')
  }
}

function handleUseSession(item) {
  conversationId.value = item.conversation_id
  showHistoryModal.value = false
  input.value = ''
  // 将焦点对准输入框
  nextTick(() => {
    scrollToBottom()
  })
}

function filterBySession(cid) {
  selectedSessionId.value = selectedSessionId.value === cid ? '' : cid
  loadHistoryData()
}

function usePrompt(text) {
  input.value = text
}

function onSubmit() {
  if (!composing.value) send()
}

function toggleTrace(index) {
  openTrace.value = openTrace.value === index ? -1 : index
}

function agentLabel(agent) {
  if (!agent) return '客服'
  if (AGENT_LABELS[agent]) return AGENT_LABELS[agent]
  if (agent.includes(',')) {
    return agent
      .split(',')
      .map((a) => AGENT_LABELS[a.trim()] || a.trim())
      .join(' & ')
  }
  return agent
}

function modeLabel(mode) {
  return MODE_LABELS[mode] || mode || ''
}

function latestThinkingTitle(m) {
  if (!m || !m.thoughts || !m.thoughts.length) return ''
  const running = m.thoughts.slice().reverse().find((t) => t.status === 'running')
  if (running) return running.title
  return m.thoughts[m.thoughts.length - 1].title
}

function formatThoughtsFallback(m) {
  if (!m || !m.thoughts || !m.thoughts.length) return ''
  return m.thoughts
    .map((th) => {
      const marker = th.status === 'running' ? '▸' : '✓'
      const detailText = th.detail ? ` — ${th.detail}` : ''
      return `${marker} ${th.title}${detailText}`
    })
    .join('\n')
}

watch([messages, conversationId], saveSession, { deep: true })

watch(
  () => authStore.isAuthenticated.value,
  (isAuth) => {
    if (isAuth) {
      loadHistoryData()
    } else {
      historyRecords.value = []
      historyTotal.value = 0
      userSessions.value = []
    }
  },
  { immediate: true },
)

onMounted(() => {
  scrollToBottom()
  refreshCacheStats()
  if (authStore.isAuthenticated.value) {
    loadHistoryData()
  }
})
</script>

<template>
  <section class="card cs-card">
    <header class="cs-head">
      <div>
        <h2 class="cs-title">智能客服</h2>
        <p class="cs-sub">LangGraph 多 Agent · Mem0 长期记忆 (user_id 隔离) · Text-to-SQL · Redis 语义缓存</p>
      </div>
      <div class="head-actions">
        <div v-if="cacheStats && cacheStats.connected" class="cache-stat-pill" :title="'Redis 地址: ' + cacheStats.redis_host + ':' + cacheStats.redis_port + ' | 相似度阈值: ' + cacheStats.similarity_threshold">
          <span class="cache-stat-dot"></span>
          <span>⚡ 语义缓存: {{ cacheStats.total_cached }}条已存</span>
          <span class="cache-stat-divider">·</span>
          <span>命中 {{ cacheStats.hits }} 次</span>
          <button class="cache-clear-link" type="button" title="清空语义缓存数据" @click="handleClearCache">清空</button>
        </div>

        <!-- 我的提问记录按钮 (登录用户专属) -->
        <button
          class="history-btn"
          type="button"
          :title="authStore.isAuthenticated.value ? '查看我的专属智能问答记录' : '登录后查看我的提问记录'"
          @click="openHistory"
        >
          📜 我的提问
          <span v-if="authStore.isAuthenticated.value && historyTotal > 0" class="history-count-badge">
            {{ historyTotal }}
          </span>
        </button>

        <button class="reset-btn" type="button" @click="resetSession">新会话</button>
      </div>
    </header>

    <!-- 用户登录状态提示条 -->
    <div v-if="authStore.isAuthenticated.value" class="user-status-bar logged-in">
      <span class="user-status-icon">👤</span>
      <span class="user-status-text">
        登录账号：<strong>{{ authStore.currentUser.value?.nickname || authStore.currentUser.value?.username }}</strong>
        <span class="role-tag">{{ authStore.currentUser.value?.role === 'admin' ? '管理员' : '学员' }}</span>
        · 已记录 <strong>{{ historyTotal }}</strong> 次专属问答
      </span>
      <button class="view-history-link" type="button" @click="openHistory">查看我的问答明细 →</button>
    </div>
    <div v-else class="user-status-bar guest">
      <span class="user-status-icon">💡</span>
      <span class="user-status-text">当前处于游客模式，提问仅保存在本地临时缓存中。</span>
      <button class="login-prompt-btn" type="button" @click="authStore.openLogin">登录账号云端保存记录</button>
    </div>

    <div ref="listEl" class="chat-list">
      <div v-for="(m, index) in messages" :key="index" class="row" :class="m.role">
        <div class="bubble">
          <!-- 深度推理与思考过程卡片（永久展开，无折叠按钮，逐字打字机流式展示） -->
          <!-- 深度思考与推理流（无折叠按钮，永久展开，打字机流式逐字输出） -->
          <div
            v-if="m.role === 'assistant' && (m.thinkingText || m.thinking || m.thoughts?.length)"
            class="thought-card"
            :class="{ 'is-thinking': m.thinking || m.thinkingTyping, 'is-typing': m.typing }"
          >
            <div class="thought-header">
              <div class="thought-header-left">
                <span class="thought-icon" :class="{ 'pulse-icon': m.thinking || m.thinkingTyping }">
                  {{ (m.thinking || m.thinkingTyping) ? '🧠' : m.typing ? '💬' : '✓' }}
                </span>
                <span class="thought-title">
                  <template v-if="m.thinking || m.thinkingTyping">
                    AI 深度思考推理流
                    <span class="thinking-spinner"></span>
                  </template>
                  <template v-else-if="m.typing">
                    AI 深度思考推理流 (推理完成 · 正在作答)
                  </template>
                  <template v-else>
                    AI 深度思考推理流 (全链路推理完成 · 共 {{ m.thoughts?.length || 0 }} 环节)
                  </template>
                </span>
                <span v-if="m.thinking || m.thinkingTyping" class="live-badge">🔴 LIVE 思考直播中</span>
                <span v-else-if="m.typing" class="live-badge answer-badge">⚡ 实时作答中</span>
                <span v-else class="done-badge">✓ 推理完毕</span>
              </div>
            </div>

            <!-- 思考推理流水线终端展示（彻底移除折叠，逐字打字机流式打印） -->
            <div class="thought-body">
              <pre class="thought-stream-text">{{ m.thinkingText || formatThoughtsFallback(m) }}<span v-if="m.thinking || m.thinkingTyping" class="thought-cursor">▌</span></pre>
            </div>
          </div>

          <!-- 回答正文内容（带专属标题栏与平滑打字机光标） -->
          <div class="text-content">
            <div
              v-if="m.role === 'assistant' && (m.thinkingText || m.thoughts?.length) && (m.content || m.typing)"
              class="answer-section-header"
            >
              <span class="answer-header-icon">💬</span>
              <span class="answer-header-text">客服答复：</span>
            </div>
            <div v-if="m.content" class="text">
              <span>{{ m.content }}</span>
              <span v-if="m.typing" class="typewriter-cursor">▌</span>
            </div>
            <div v-else-if="m.thinking || m.thinkingTyping" class="answering-placeholder">
              <span class="typing-cursor"></span>
              <span class="waiting-text">{{ latestThinkingTitle(m) || '正在深度思考并组织作答...' }}</span>
            </div>
          </div>

          <!-- 专员标签与模式 -->
          <div v-if="m.role === 'assistant' && (m.agent || m.mode)" class="meta-line">
            <span
              class="agent-chip"
              :class="{
                'security-chip': m.agent === 'security_guard',
                'clarification-chip': m.agent === 'clarification_agent',
                'cache-chip': m.agent === 'semantic_cache',
                'sql-chip': m.agent === 'text_to_sql_agent',
              }"
            >
              {{ agentLabel(m.agent) }}
            </span>
            <span
              v-if="m.mode"
              class="mode-chip"
              :class="{ 'cache-mode': m.mode === 'cache', 'sql-mode': m.mode === 'sql' }"
            >
              {{ modeLabel(m.mode) }}
            </span>
          </div>

          <div v-if="m.role === 'assistant' && m.trace?.length" class="trace-block">
            <button class="trace-toggle" type="button" @click="toggleTrace(index)">
              {{ openTrace === index ? '收起' : '展开' }}调度流程（{{ m.trace.length }} 步）
            </button>
            <ol v-if="openTrace === index" class="trace">
              <li v-for="(step, i) in m.trace" :key="i"><code>{{ step }}</code></li>
            </ol>
          </div>
        </div>
      </div>
    </div>

    <!-- 语义缓存与 Text-to-SQL 推荐提问测试快捷气泡 -->
    <div class="quick-prompts">
      <span class="prompt-hint">💡 推荐提问测试：</span>
      <button type="button" class="prompt-chip" @click="usePrompt('请问易学商城购买商品后如何申请开具发票？')">
        1. 发票申请 (首问·写入缓存)
      </button>
      <button type="button" class="prompt-chip" @click="usePrompt('在商城买完东西之后怎么开发票？')">
        2. 发票咨询 (相似提问·秒级命中)
      </button>
      <button type="button" class="prompt-chip" @click="usePrompt('请问商城的退换货流程和运费政策是怎样的？')">
        3. 退换货政策
      </button>
      <button type="button" class="prompt-chip sql-chip-btn" @click="usePrompt('陈小明 买过899的商品')">
        4. 🔍 Text-to-SQL (陈小明 买过899的商品)
      </button>
      <button type="button" class="prompt-chip sql-chip-btn" @click="usePrompt('我都买过什么商品？')">
        5. 👤 个人购买 (我都买过什么商品？)
      </button>
    </div>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <form class="input-form" @submit.prevent="onSubmit">
      <input
        v-model="input"
        class="chat-input"
        type="text"
        autocomplete="off"
        placeholder="输入您的问题，例如：发票怎么开？我的订单到哪了？"
        :disabled="sending"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      />
      <button class="send-btn" type="submit" :disabled="!canSend">
        <span v-if="sending" class="spinner"></span>
        {{ sending ? '回复中…' : '发送' }}
      </button>
    </form>

    <!-- 我的提问与解答记录抽屉/弹窗 (按登录用户完全隔离) -->
    <Teleport to="body">
      <div v-if="showHistoryModal" class="modal-backdrop" @click.self="showHistoryModal = false">
        <div class="modal-card history-modal">
          <header class="modal-head">
            <div class="modal-title-wrap">
              <h3 class="modal-title">📜 我的专属智能问答记录</h3>
              <p class="modal-sub">
                账号：<strong>{{ authStore.currentUser.value?.nickname || authStore.currentUser.value?.username }}</strong>
                · 共记录 <strong>{{ historyTotal }}</strong> 次问答（独立隔离保存）
              </p>
            </div>
            <button class="close-btn" type="button" @click="showHistoryModal = false">✕</button>
          </header>

          <div class="modal-body history-body">
            <!-- 搜索与筛选工具栏 -->
            <div class="history-toolbar">
              <div class="search-box">
                <input
                  v-model="historyKeyword"
                  type="text"
                  placeholder="搜索我问过的问题或解答关键词..."
                  class="search-input"
                  @keyup.enter="loadHistoryData"
                />
                <button type="button" class="search-btn" @click="loadHistoryData">搜索</button>
              </div>
              <div class="history-actions">
                <button type="button" class="tool-btn refresh-btn" @click="loadHistoryData">🔄 刷新</button>
                <button v-if="historyTotal > 0" type="button" class="tool-btn clear-btn" @click="handleClearAllUserHistory">🗑️ 清空所有记录</button>
              </div>
            </div>

            <!-- 会话筛选标签 (若有多个会话) -->
            <div v-if="userSessions.length > 1" class="session-filter-chips">
              <span class="filter-label">会话筛选:</span>
              <button
                type="button"
                class="session-chip"
                :class="{ active: !selectedSessionId }"
                @click="filterBySession('')"
              >
                全部会话
              </button>
              <button
                v-for="sess in userSessions"
                :key="sess.conversation_id"
                type="button"
                class="session-chip"
                :class="{ active: selectedSessionId === sess.conversation_id }"
                @click="filterBySession(sess.conversation_id)"
              >
                {{ sess.first_question }} ({{ sess.total_qas }}条)
              </button>
            </div>

            <!-- 加载状态 -->
            <div v-if="historyLoading" class="loading-state">
              <span class="spinner dark"></span>
              <span>正在获取您的历史问答记录...</span>
            </div>

            <!-- 空状态 -->
            <div v-else-if="!historyRecords.length" class="empty-state">
              <div class="empty-icon">📭</div>
              <p class="empty-title">暂无提问记录</p>
              <p class="empty-desc">
                {{ historyKeyword ? '没有找到包含该关键字的问答' : '您在此账号下尚未向智能客服提问过，快去咨询吧～' }}
              </p>
            </div>

            <!-- 问答记录卡片列表 -->
            <div v-else class="history-list">
              <div v-for="item in historyRecords" :key="item.id" class="history-card">
                <div class="history-card-header">
                  <div class="card-meta">
                    <span class="time-tag">🕒 {{ item.created_at }}</span>
                    <span class="agent-tag" :class="item.agent">{{ agentLabel(item.agent) }}</span>
                    <span class="mode-tag">{{ modeLabel(item.mode) }}</span>
                  </div>
                  <div class="card-ops">
                    <button
                      type="button"
                      class="op-btn use-session-btn"
                      title="切换到当前会话继续提问"
                      @click="handleUseSession(item)"
                    >
                      继续提问 ↗
                    </button>
                    <button
                      type="button"
                      class="op-btn delete-btn"
                      title="删除此条记录"
                      @click="handleDeleteHistoryItem(item.id)"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                <div class="history-qa-content">
                  <div class="qa-item question-row">
                    <span class="qa-badge q-badge">问</span>
                    <div class="qa-bubble q-bubble">
                      <p class="qa-text">{{ item.question }}</p>
                    </div>
                  </div>
                  <div class="qa-item answer-row">
                    <span class="qa-badge a-badge">答</span>
                    <div class="qa-bubble a-bubble">
                      <p class="qa-text">{{ item.answer }}</p>
                      <div v-if="item.trace_summary" class="trace-summary-pill">
                        流程追踪: {{ item.trace_summary }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.cs-card {
  display: flex;
  flex-direction: column;
  height: min(680px, calc(100vh - 220px));
  min-height: 420px;
  padding: 22px 22px 20px;
}

.cs-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cache-stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 999px;
  font-weight: 500;
}

.cache-stat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #16a34a;
  box-shadow: 0 0 6px #16a34a;
}

.cache-stat-divider {
  opacity: 0.35;
}

.cache-clear-link {
  border: none;
  background: transparent;
  color: #b91c1c;
  cursor: pointer;
  padding: 0 2px;
  font-size: 11px;
  text-decoration: underline;
  opacity: 0.75;
}

.cache-clear-link:hover {
  opacity: 1;
}

.cs-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.cs-sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.reset-btn {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--brand);
  background: #eef1ff;
  border: none;
  border-radius: 999px;
  padding: 7px 16px;
  transition: background 0.15s;
}

.reset-btn:hover {
  background: #e2e7ff;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.row {
  display: flex;
}

.row.user {
  justify-content: flex-end;
}

.row.assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 78%;
  padding: 12px 16px;
  border-radius: 14px;
  word-break: break-word;
}

.row.user .bubble {
  color: #fff;
  background: var(--brand);
  border-bottom-right-radius: 4px;
}

.row.assistant .bubble {
  color: #3c465c;
  background: #f2f4fa;
  border-bottom-left-radius: 4px;
}

.bubble .text {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.meta-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.agent-chip {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand-dark);
  background: #e6eaff;
  border-radius: 999px;
  padding: 2px 10px;
}

.agent-chip.security-chip {
  color: #b91c1c;
  background: #fee2e2;
  border: 1px solid #fca5a5;
}

.agent-chip.clarification-chip {
  color: #b45309;
  background: #fef3c7;
  border: 1px solid #fde68a;
}

.agent-chip.cache-chip {
  color: #047857;
  background: #d1fae5;
  border: 1px solid #6ee7b7;
}

.agent-chip.sql-chip {
  color: #0369a1;
  background: #e0f2fe;
  border: 1px solid #7dd3fc;
}

.mode-chip {
  font-size: 11.5px;
  color: var(--ink-soft);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 1.5px 10px;
}

.mode-chip.cache-mode {
  color: #047857;
  background: #ecfdf5;
  border-color: #a7f3d0;
  font-weight: 600;
}

.mode-chip.sql-mode {
  color: #0284c7;
  background: #f0f9ff;
  border-color: #bae6fd;
  font-weight: 600;
}

/* ===== 深度思考与推理过程卡片 (无折叠按钮，永久展开，打字机流式动效) ===== */
.thought-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #6366f1;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
  transition: all 0.25s ease;
}

.thought-card.is-thinking {
  border-color: #c7d2fe;
  border-left-color: #4f46e5;
  background: #f5f7ff;
  box-shadow: 0 2px 10px rgba(99, 102, 241, 0.08);
}

.thought-card.is-typing {
  border-color: #e2e8f0;
  border-left-color: #10b981;
  background: #fbfcfe;
}

.live-badge {
  font-size: 10px;
  font-weight: 700;
  color: #ef4444;
  background: #fee2e2;
  padding: 2px 7px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  letter-spacing: 0.5px;
  animation: livePulse 1.8s infinite;
}

.live-badge.answer-badge {
  color: #2563eb;
  background: #dbeafe;
}

.done-badge {
  font-size: 10px;
  font-weight: 600;
  color: #16a34a;
  background: #dcfce7;
  padding: 2px 7px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
}

@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.thought-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  background: rgba(241, 245, 249, 0.7);
  border-bottom: 1px solid #e2e8f0;
  user-select: none;
}

.thought-card.is-thinking .thought-header {
  background: rgba(238, 242, 255, 0.85);
  border-bottom-color: #e0e7ff;
}

.thought-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.thought-card.is-thinking .thought-header-left {
  color: #4338ca;
}

.thought-icon {
  font-size: 15px;
}

.pulse-icon {
  display: inline-block;
  animation: brainPulse 1.6s ease-in-out infinite;
}

@keyframes brainPulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.18);
    opacity: 0.75;
  }
}

.thinking-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid #a5b4fc;
  border-top-color: #4f46e5;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-left: 6px;
  vertical-align: middle;
}

.thought-body {
  padding: 12px 14px;
  max-height: 480px;
  overflow-y: auto;
  font-size: 12.5px;
  background: #f8fafc;
}

.thought-stream-text {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12.8px;
  line-height: 1.8;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 2px 0;
  letter-spacing: 0.2px;
}

.thought-cursor {
  display: inline-block;
  color: #6366f1;
  font-weight: 900;
  font-size: 14px;
  margin-left: 2px;
  animation: cursorBlink 0.7s infinite;
  user-select: none;
  vertical-align: baseline;
}

.answer-section-header {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #475569;
  font-weight: 600;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px dashed #e2e8f0;
}

.answer-header-icon {
  font-size: 13px;
}

.answering-placeholder {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #6366f1;
  font-size: 13px;
  padding: 6px 0;
}

.typing-cursor {
  display: inline-block;
  width: 8px;
  height: 14px;
  background: #6366f1;
  border-radius: 1px;
  animation: cursorBlink 0.8s infinite;
}

.typewriter-cursor {
  display: inline-block;
  color: #4f46e5;
  font-weight: 900;
  margin-left: 2px;
  animation: cursorBlink 0.7s infinite;
  user-select: none;
  vertical-align: baseline;
}

@keyframes cursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.typing {
  display: flex;
  gap: 5px;
  align-items: center;
  padding: 16px 18px;
}

.dot {
  width: 7px;
  height: 7px;
  background: #b6bfd4;
  border-radius: 50%;
  animation: blink 1.2s ease-in-out infinite;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%,
  70%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  35% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

.error-banner {
  margin: 12px 0 0;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--bad);
  background: #fdeaea;
  border-radius: 10px;
}

.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}

.prompt-hint {
  font-size: 12px;
  color: #64748b;
  font-weight: 600;
}

.prompt-chip {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.prompt-chip:hover {
  background: #eef2ff;
  border-color: #818cf8;
  color: var(--brand);
  transform: translateY(-1px);
}

.prompt-chip.sql-chip-btn {
  background: #f0fdf4;
  border-color: #86efac;
  color: #15803d;
  font-weight: 600;
}

.prompt-chip.sql-chip-btn:hover {
  background: #dcfce7;
  border-color: #4ade80;
  color: #166534;
}

.input-form {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.chat-input {
  flex: 1;
  min-width: 0;
  padding: 12px 16px;
  font-size: 15px;
  color: var(--ink);
  border: 1.5px solid var(--line);
  border-radius: 12px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.chat-input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 4px rgba(79, 109, 245, 0.12);
}

.chat-input:disabled {
  background: #f7f8fb;
}

.send-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 26px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  background: var(--brand);
  border: none;
  border-radius: 12px;
  transition: background 0.15s, transform 0.05s;
  white-space: nowrap;
}

.send-btn:hover:not(:disabled) {
  background: var(--brand-dark);
}

.send-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.send-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.trace-block {
  margin-top: 8px;
  border-top: 1px dashed #d5dbea;
  padding-top: 8px;
}

.trace-toggle {
  font-size: 12px;
  color: var(--brand);
  background: none;
  border: none;
  padding: 0;
}

.trace-toggle:hover {
  text-decoration: underline;
}

.trace {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--ink-soft);
}

.trace code {
  font-family: 'Cascadia Code', Consolas, monospace;
  background: #fff;
  border-radius: 4px;
  padding: 1px 5px;
  word-break: break-all;
}

@media (max-width: 560px) {
  .bubble {
    max-width: 88%;
  }
  .input-form {
    flex-direction: column;
  }
  .send-btn {
    justify-content: center;
  }
}

/* 历史问答按钮 & 徽标 */
.history-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 500;
  color: #3b82f6;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.history-btn:hover {
  background: #dbeafe;
  color: #1d4ed8;
  transform: translateY(-1px);
}

.history-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #2563eb;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  line-height: 1;
}

/* 用户状态提示条 */
.user-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.user-status-bar.logged-in {
  background: #f0f7ff;
  border: 1px solid #c7dcfb;
  color: #1e3a8a;
}

.user-status-bar.guest {
  background: #fefce8;
  border: 1px solid #fef08a;
  color: #854d0e;
}

.user-status-icon {
  font-size: 14px;
}

.user-status-text {
  flex: 1;
}

.role-tag {
  display: inline-block;
  font-size: 11px;
  background: #dbeafe;
  color: #1d4ed8;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 4px;
  font-weight: 600;
}

.view-history-link {
  border: none;
  background: transparent;
  color: #2563eb;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  transition: text-decoration 0.15s;
}

.view-history-link:hover {
  text-decoration: underline;
}

.login-prompt-btn {
  border: none;
  background: #eab308;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s;
}

.login-prompt-btn:hover {
  background: #ca8a04;
}

/* 历史记录抽屉 / 弹窗 */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.history-modal {
  position: relative;
  width: 100%;
  max-width: 800px;
  max-height: 85vh;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideUp {
  from {
    transform: translateY(20px) scale(0.98);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}

.modal-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.modal-sub {
  margin: 0;
  font-size: 12.5px;
  color: #64748b;
}

.modal-sub strong {
  color: #3b82f6;
}

.close-btn {
  border: none;
  background: #f1f5f9;
  color: #64748b;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.close-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.history-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 工具栏 */
.history-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 240px;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  transition: border-color 0.15s;
}

.search-box:focus-within {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.search-input {
  flex: 1;
  border: none;
  padding: 8px 12px;
  font-size: 13.5px;
  outline: none;
  color: #1e293b;
}

.search-btn {
  border: none;
  background: #f1f5f9;
  color: #475569;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.search-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.history-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-btn {
  border: 1px solid #e2e8f0;
  background: #fff;
  font-size: 12.5px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  color: #475569;
}

.tool-btn:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.clear-btn {
  color: #dc2626;
  border-color: #fecaca;
  background: #fef2f2;
}

.clear-btn:hover {
  background: #fee2e2;
  border-color: #fca5a5;
}

/* 会话筛选 */
.session-filter-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.filter-label {
  font-size: 12px;
  color: #64748b;
  font-weight: 600;
  white-space: nowrap;
}

.session-chip {
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  max-width: 220px;
  text-overflow: ellipsis;
  overflow: hidden;
}

.session-chip:hover {
  background: #edf2f7;
  border-color: #cbd5e1;
}

.session-chip.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1d4ed8;
  font-weight: 600;
}

/* 加载 & 空状态 */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
}

.loading-state {
  gap: 12px;
  color: #64748b;
  font-size: 14px;
}

.spinner.dark {
  border-color: rgba(59, 130, 246, 0.2);
  border-top-color: #3b82f6;
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 8px;
}

.empty-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #334155;
}

.empty-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: #94a3b8;
}

/* 记录卡片列表 */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.history-card {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #ffffff;
  padding: 14px 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.15s, border-color 0.15s;
}

.history-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.history-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #64748b;
  flex-wrap: wrap;
}

.time-tag {
  color: #64748b;
}

.agent-tag {
  background: #f1f5f9;
  color: #334155;
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 500;
}

.agent-tag.semantic_cache {
  background: #d1fae5;
  color: #065f46;
}

.agent-tag.text_to_sql_agent {
  background: #e0f2fe;
  color: #0369a1;
}

.agent-tag.security_guard {
  background: #fee2e2;
  color: #991b1b;
}

.agent-tag.clarification_agent {
  background: #fef3c7;
  color: #92400e;
}

.mode-tag {
  border: 1px solid #e2e8f0;
  color: #64748b;
  padding: 0 6px;
  border-radius: 4px;
}

.card-ops {
  display: flex;
  align-items: center;
  gap: 8px;
}

.op-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  transition: all 0.15s;
}

.use-session-btn {
  font-size: 12px;
  color: #2563eb;
  font-weight: 500;
  background: #eff6ff;
  padding: 3px 8px;
}

.use-session-btn:hover {
  background: #dbeafe;
}

.delete-btn {
  font-size: 13px;
  opacity: 0.6;
}

.delete-btn:hover {
  opacity: 1;
  background: #fee2e2;
}

/* 问答内容区域 */
.history-qa-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qa-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.qa-badge {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  margin-top: 2px;
}

.q-badge {
  background: #3b82f6;
  color: #ffffff;
}

.a-badge {
  background: #10b981;
  color: #ffffff;
}

.qa-bubble {
  flex: 1;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13.5px;
  line-height: 1.6;
  word-break: break-word;
}

.q-bubble {
  background: #f0f7ff;
  color: #1e3a8a;
  font-weight: 500;
}

.a-bubble {
  background: #f8fafc;
  color: #334155;
  border: 1px solid #f1f5f9;
}

.qa-text {
  margin: 0;
  white-space: pre-wrap;
}

.trace-summary-pill {
  margin-top: 6px;
  font-size: 11.5px;
  color: #64748b;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 6px;
  display: inline-block;
  font-family: 'Cascadia Code', Consolas, monospace;
}
</style>
