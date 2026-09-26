<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
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
  order_agent: '📦 订单专员',
  product_agent: '🛍️ 商品咨询',
  aftersale_agent: '🔄 售后专员',
  chitchat_agent: '💬 通用客服',
  security_guard: '🛡️ 安全风控',
  clarification_agent: '❓ 信息澄清',
  semantic_cache: '⚡ 语义缓存',
}

const MODE_LABELS = {
  sql: '📊 SQL直查',
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

let activeTypewriterTimer = null

// ===== 历史提问列表与查看状态 =====
const selectedHistoryId = ref(null)
const historySearchKeyword = ref('')
const historyLoading = ref(false)
const historyRecords = ref([])
const historyTotal = ref(0)
const guestHistoryRecords = ref([])

const canSend = computed(() => !sending.value)

// 整合历史列表（登录用户以数据库隔离存储为主，访客使用临时内存记录）
const allHistoryRecords = computed(() => {
  if (authStore.isAuthenticated.value) {
    return historyRecords.value
  }
  return guestHistoryRecords.value
})

// 根据搜索关键词过滤后的历史提问列表
const displayHistoryList = computed(() => {
  const list = allHistoryRecords.value || []
  const kw = historySearchKeyword.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter((r) => {
    return (
      (r.question && r.question.toLowerCase().includes(kw)) ||
      (r.answer && r.answer.toLowerCase().includes(kw)) ||
      (r.created_at && r.created_at.includes(kw))
    )
  })
})

// 当前选中的历史记录详情
const selectedHistoryItem = computed(() => {
  if (selectedHistoryId.value === null) return null
  return allHistoryRecords.value.find((r) => r.id === selectedHistoryId.value) || null
})

function greeting() {
  return [
    {
      role: 'assistant',
      content: '您好，我是易学商城智能客服～\n可以帮您解答订单查询、商品咨询、退换货及发票等问题，请直接在右下方输入您的问题。左侧可随时回顾您的历史提问和全链路推理过程！',
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
    // 忽略异常
  }
  messages.value = greeting()
}

let saveSessionTimer = null
function saveSession() {
  if (saveSessionTimer) clearTimeout(saveSessionTimer)
  saveSessionTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ conversationId: conversationId.value, messages: messages.value }),
      )
    } catch {
      // 忽略异常
    }
  }, 300)
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
  selectedHistoryId.value = null
  error.value = ''
}

// 选择左侧的历史问题，在右侧展示答案与全链路推理过程
function selectHistoryItem(item) {
  selectedHistoryId.value = item.id
}

// 开始提新问题，切回实时交互对话流
function startNewQuestion() {
  selectedHistoryId.value = null
  input.value = ''
  nextTick(() => {
    scrollToBottom()
  })
}

// 从历史详情返回实时对话视图
function returnToLiveChat() {
  selectedHistoryId.value = null
  nextTick(() => {
    scrollToBottom()
  })
}

// 基于历史问题继续追问
function handleFollowUp(item) {
  conversationId.value = item.conversation_id || conversationId.value
  input.value = `关于“${item.question}”：`
  selectedHistoryId.value = null
  nextTick(() => {
    scrollToBottom()
  })
}

// 解析并格式化历史提问记录的中间推理过程（无折叠，完整公开透明展示）
function getHistoryReasoningSteps(item) {
  if (!item) return []

  const rawTrace = item.trace || []
  const summary = item.trace_summary || ''
  
  let rawSteps = []
  if (Array.isArray(rawTrace) && rawTrace.length) {
    rawSteps = rawTrace
  } else if (summary) {
    if (summary.includes(' -> ')) {
      rawSteps = summary.split(' -> ').map((s) => s.trim()).filter(Boolean)
    } else {
      rawSteps = summary.split('\n').map((s) => s.trim()).filter(Boolean)
    }
  }

  if (rawSteps.length > 0) {
    const formatted = []
    formatted.push({
      icon: '✓ 🚀',
      title: '工作流引擎初始化',
      detail: '初始化多智能体协同流水线与会话上下文',
    })

    for (const stepStr of rawSteps) {
      if (stepStr.startsWith('[') && stepStr.endsWith(']')) {
        if (formatted.length > 0 && formatted[formatted.length - 1].title.includes('长期记忆')) {
          formatted[formatted.length - 1].detail += ` (检索结果: ${stepStr.slice(0, 90)}...)`
        }
        continue
      }

      let node = ''
      let detail = stepStr
      if (stepStr.includes(':')) {
        const colonIdx = stepStr.indexOf(':')
        node = stepStr.slice(0, colonIdx).trim()
        detail = stepStr.slice(colonIdx + 1).trim()
      }

      let icon = '✓'
      let title = node || '推理环节'

      if (node.includes('security') || detail.includes('安全审查') || detail.includes('拦截')) {
        icon = detail.includes('拦截') ? '⚠️ 🛡️' : '✓ 🛡️'
        title = detail.includes('拦截') ? '输入安全风控拦截' : '输入安全风控审查通过'
      } else if (node.includes('mem0') || detail.includes('长期记忆') || detail.includes('记忆')) {
        icon = '✓ 🧠'
        title = '专属长期记忆检索'
      } else if (node.includes('rewrite') || detail.includes('重写') || detail.includes('意图')) {
        icon = '✓ 🔍'
        title = '意图分析与消歧重写'
      } else if (node.includes('semantic_cache') || detail.includes('语义缓存') || detail.includes('缓存')) {
        icon = '✓ ⚡'
        title = detail.includes('命中') ? 'Redis 语义缓存秒级命中' : 'Redis 语义缓存检索'
      } else if (node.includes('supervisor') || detail.includes('主管') || detail.includes('派发')) {
        icon = '✓ 🧭'
        title = 'Supervisor 智能分派'
      } else if (node.includes('sql') || detail.includes('SQL')) {
        icon = '✓ 📊'
        title = 'Text-to-SQL 数据专员'
      } else if (node.includes('order')) {
        icon = '✓ 📦'
        title = '订单专员业务处理'
      } else if (node.includes('aftersale')) {
        icon = '✓ 🔄'
        title = '售后专员业务解答'
      } else if (node.includes('product')) {
        icon = '✓ 🛍️'
        title = '商品咨询专员'
      } else if (node.includes('cache_store')) {
        icon = '✓ 💾'
        title = '问答对沉淀至语义缓存'
      } else {
        icon = '✓ 💬'
        title = agentLabel(item.agent) || '智能客服专员'
      }

      formatted.push({ icon, title, detail })
    }

    const hasAgentStep = formatted.some((s) => s.title.includes('专员') || s.title.includes('客服'))
    if (!hasAgentStep && item.agent) {
      formatted.push({
        icon: '✓ 💬',
        title: `${agentLabel(item.agent)}专业作答`,
        detail: '业务大模型精准推理组织回复',
      })
    }

    return formatted
  }

  // 标准全链路推理环节兜底（保障历史数据始终具备清晰的推理流程）
  const fallbackSteps = [
    { icon: '✓ 🚀', title: '工作流引擎初始化', detail: '初始化多智能体协同流水线与会话上下文' },
    { icon: '✓ 🛡️', title: '输入安全风控审查通过', detail: '检测提示词注入与越狱风险，合规校验通过并放行' },
    { icon: '✓ 🧠', title: '专属长期记忆检索完成', detail: '按 user_id 检索专属上下文偏好与历史记忆' },
    { icon: '✓ 🔍', title: '意图分析与上下文重写', detail: '结合多轮对话上下文消除歧义，提取核心业务诉求' },
  ]

  if (item.mode === 'cache') {
    fallbackSteps.push({
      icon: '✓ ⚡',
      title: 'Redis 语义缓存秒级命中',
      detail: '提问向量相似度达到阈值，秒级直接输出高价值缓存答案',
    })
  } else {
    fallbackSteps.push({
      icon: '✓ ⚡',
      title: 'Redis 语义缓存检索完成',
      detail: '未达相似度阈值，进入多 Agent 协作推理链路',
    })
    const agentName = agentLabel(item.agent)
    fallbackSteps.push({
      icon: '✓ 🧭',
      title: 'Supervisor 调度主管智能分派',
      detail: `意图识别完成，任务精准路由分派至 ${agentName}`,
    })
    if (item.agent === 'text_to_sql_agent' || item.mode === 'sql') {
      fallbackSteps.push({
        icon: '✓ 📊',
        title: 'Text-to-SQL 数据专员查询',
        detail: '解析自然语言生成参数化 SQL，直查业务数据库汇总指标与订单数据',
      })
    } else {
      fallbackSteps.push({
        icon: '✓ 💬',
        title: `${agentName}专业解答`,
        detail: '业务大模型精准推理组织专业规范回复',
      })
    }
    fallbackSteps.push({
      icon: '✓ 💾',
      title: '知识沉淀与语义缓存写入',
      detail: '优质问答对自动向量化并持久化至 Redis 语义缓存',
    })
  }

  return fallbackSteps
}

function formatHistoryReasoningText(item) {
  const steps = getHistoryReasoningSteps(item)
  return steps.map((s) => `${s.icon} ${s.title} — ${s.detail}`).join('\n')
}

// 核心流式提问处理函数
async function send() {
  const text = input.value.trim()
  if (!text || sending.value) return
  input.value = ''
  error.value = ''

  // 若此前处于历史详情查看状态，自动切回实时问答流
  if (selectedHistoryId.value !== null) {
    selectedHistoryId.value = null
  }

  // 1. 用户提问消息即刻入列
  messages.value.push({ role: 'user', content: text })
  sending.value = true

  // 2. 助理气泡即刻入列（使用 reactive 确保打字机高频修改时 Vue 响应式驱动 DOM 实时逐字渲染）
  const assistantMsg = reactive({
    role: 'assistant',
    content: '',
    agent: '',
    mode: '',
    trace: [],
    thoughts: [],
    thinking: true,
    thinkingText: '',
    thinkingTyping: true,
    typing: false,
  })
  messages.value.push(assistantMsg)
  scrollToBottom()

  // 全链路双轨打字机队列：思考推理流先出，作答正文紧随其后逐字输出 (12ms 高频时钟)
  let thoughtCharBuffer = ''
  let tokenBuffer = ''
  let typewriterTimer = null
  let isStreamDone = false
  let pendingDoneEvt = null
  let hasStartedAnswering = false

  const nowFormatted = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')

  // 0ms 零延迟即刻装载首批工作流推理步骤，打字机立刻启动向外蹦字
  thoughtCharBuffer += '▸ 🚀 正在启动智能客服 Agent 思考流... — 初始化多智能体协同流水线与会话上下文\n'
  thoughtCharBuffer += '▸ 🛡️ 正在进行输入安全风控审查... — 检测提示词注入、角色越狱与指令合规性\n'
  assistantMsg.thoughts.push({
    node: 'workflow_start',
    title: '🚀 正在启动智能客服 Agent 思考流...',
    detail: '初始化多智能体协同流水线与会话上下文',
    status: 'done',
  })
  assistantMsg.thoughts.push({
    node: 'security_check',
    title: '🛡️ 正在进行输入安全风控审查...',
    detail: '检测提示词注入、角色越狱与指令合规性',
    status: 'running',
  })

  const flushTypewriter = () => {
    let hasWork = false

    // 1. 思考推理流打字机（思考流严格先于回答正文完成打字）
    if (thoughtCharBuffer.length > 0) {
      hasWork = true
      const speedBoost = (!hasStartedAnswering && tokenBuffer.length > 0) ? 2 : 1
      const step = thoughtCharBuffer.length > 45 ? (3 * speedBoost) : thoughtCharBuffer.length > 15 ? (2 * speedBoost) : 1
      const chars = thoughtCharBuffer.slice(0, step)
      thoughtCharBuffer = thoughtCharBuffer.slice(step)
      assistantMsg.thinkingText += chars
      assistantMsg.thinkingTyping = true
    } else {
      assistantMsg.thinkingTyping = false
    }

    // 2. 思考流当前环节排空后，开启作答阶段并驱动回答正文打字机
    if (thoughtCharBuffer.length === 0 && tokenBuffer.length > 0) {
      hasStartedAnswering = true
    }

    if (hasStartedAnswering && tokenBuffer.length > 0) {
      hasWork = true
      if (assistantMsg.thinking) {
        assistantMsg.thinking = false
      }
      assistantMsg.typing = true
      const step = tokenBuffer.length > 50 ? 3 : tokenBuffer.length > 20 ? 2 : 1
      const chars = tokenBuffer.slice(0, step)
      tokenBuffer = tokenBuffer.slice(step)
      assistantMsg.content += chars
    }

    if (hasWork) {
      scrollToBottom()
    } else if (isStreamDone && thoughtCharBuffer.length === 0 && tokenBuffer.length === 0) {
      // 全链路流式彻底结束且所有打字队列完全排空
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

  // 0ms 即刻触发首屏打字机运行
  startTypewriter()

  try {
    await chatWithCsStream(conversationId.value, text, {
      onThought: (th) => {
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

        if (th.node === 'workflow_start') {
          return
        }

        if (th.node === 'security_check') {
          if (th.status === 'done') {
            thoughtCharBuffer += `✓ 🛡️ 输入安全审查通过 — ${th.detail || '输入合规无注入与越狱风险，放行至 Agent 智能工作流'}\n`
            startTypewriter()
            scrollToBottom()
          } else if (th.title?.includes('拦截') || th.detail?.includes('拦截')) {
            thoughtCharBuffer += `⚠️ 🛡️ 拦截提示词注入/越狱风险 — ${th.detail}\n`
            startTypewriter()
            scrollToBottom()
          }
          return
        }

        const marker = th.status === 'running' ? '▸' : '✓'
        const detailText = th.detail ? ` — ${th.detail}` : ''
        const line = `${marker} ${th.title}${detailText}\n`
        thoughtCharBuffer += line

        startTypewriter()
        scrollToBottom()
      },
      onToken: (tok) => {
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

        // 立即将新提问与全链路推理记录同步至左侧历史列表顶端（标注问问题的时间）
        const newRecord = {
          id: Date.now(),
          conversation_id: doneEvt.conversation_id,
          question: text,
          answer: doneEvt.reply || assistantMsg.content,
          agent: doneEvt.agent,
          mode: doneEvt.mode,
          trace: doneEvt.trace || [],
          trace_summary: Array.isArray(doneEvt.trace) ? doneEvt.trace.join(' -> ') : '',
          created_at: nowFormatted,
        }
        historyRecords.value.unshift(newRecord)
        guestHistoryRecords.value.unshift(newRecord)
        historyTotal.value++
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

async function loadHistoryData() {
  if (!authStore.isAuthenticated.value) {
    historyRecords.value = []
    historyTotal.value = 0
    return
  }
  historyLoading.value = true
  try {
    const res = await fetchUserQaHistory({
      keyword: historySearchKeyword.value.trim(),
    })
    historyRecords.value = res.items || []
    historyTotal.value = res.total || 0
  } catch (err) {
    console.error('获取个人历史问答失败:', err)
  } finally {
    historyLoading.value = false
  }
}

async function handleDeleteHistoryItem(id) {
  if (!confirm('确定要删除这条提问与解答记录吗？')) return
  try {
    if (typeof id === 'number') {
      await deleteUserQaRecord(id)
    }
    historyRecords.value = historyRecords.value.filter((r) => r.id !== id)
    guestHistoryRecords.value = guestHistoryRecords.value.filter((r) => r.id !== id)
    if (selectedHistoryId.value === id) {
      selectedHistoryId.value = null
    }
    historyTotal.value = Math.max(0, historyTotal.value - 1)
  } catch (err) {
    alert(err.message || '删除记录失败')
  }
}

async function handleClearAllUserHistory() {
  if (!confirm('确定要清空您在此账号下的所有提问与解答记录吗？此操作不可恢复。')) return
  try {
    await clearUserQaHistory()
    historyRecords.value = []
    historyTotal.value = 0
    guestHistoryRecords.value = []
    selectedHistoryId.value = null
  } catch (err) {
    alert(err.message || '清空记录失败')
  }
}

function usePrompt(text) {
  input.value = text
  if (selectedHistoryId.value !== null) {
    selectedHistoryId.value = null
  }
}

function onSubmit() {
  if (!composing.value) send()
}

function agentLabel(agent) {
  if (!agent) return '智能客服'
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
    }
  },
  { immediate: true },
)

onMounted(() => {
  loadSession()
  scrollToBottom()
  refreshCacheStats()
  if (authStore.isAuthenticated.value) {
    loadHistoryData()
  }
})
</script>

<template>
  <section class="card cs-card">
    <!-- 顶部状态栏 -->
    <header class="cs-head">
      <div class="cs-title-wrap">
        <h2 class="cs-title">智能客服</h2>
        <p class="cs-sub">LangGraph 多 Agent 协同 · Mem0 长期记忆 · Text-to-SQL · Redis 语义缓存</p>
      </div>

      <div class="head-actions">
        <!-- Redis 缓存状态指示徽章 -->
        <div
          v-if="cacheStats && cacheStats.connected"
          class="cache-stat-pill"
          :title="'Redis: ' + cacheStats.redis_host + ':' + cacheStats.redis_port + ' | 相似度阈值: ' + cacheStats.similarity_threshold"
        >
          <span class="cache-stat-dot"></span>
          <span>⚡ 语义缓存: {{ cacheStats.total_cached }}条已存</span>
          <span class="cache-stat-divider">·</span>
          <span>命中 {{ cacheStats.hits }} 次</span>
          <button class="cache-clear-link" type="button" title="清空语义缓存数据" @click="handleClearCache">清空</button>
        </div>

        <!-- 当前账号状态徽标 -->
        <div class="account-pill" :class="{ 'logged-in': authStore.isAuthenticated.value }">
          <span class="account-icon">{{ authStore.isAuthenticated.value ? '👤' : '💡' }}</span>
          <span class="account-name">
            {{ authStore.currentUser.value?.nickname || authStore.currentUser.value?.username || '游客模式' }}
          </span>
          <span v-if="authStore.isAuthenticated.value" class="account-tag">
            {{ authStore.currentUser.value?.role === 'admin' ? '管理员' : '学员' }}
          </span>
        </div>

        <button class="reset-btn" type="button" title="重置当前实时对话" @click="resetSession">🔄 清空对话</button>
      </div>
    </header>

    <!-- 主布局：左右分栏结构（左侧提问历史列表 + 标注时间；右侧展示答案与全链路推理过程） -->
    <div class="cs-layout">
      <!-- ===== 左侧：用户历史提问列表面板 ===== -->
      <aside class="cs-sidebar">
        <div class="sidebar-head">
          <div class="sidebar-title-row">
            <span class="sidebar-title">
              📋 提问历史
              <span class="sidebar-count-badge">{{ displayHistoryList.length }}条</span>
            </span>
            <button class="new-chat-btn" type="button" title="开始新的提问对话" @click="startNewQuestion">
              ➕ 新提问
            </button>
          </div>

          <!-- 搜索历史问题关键词 -->
          <div class="sidebar-search-wrap">
            <input
              v-model="historySearchKeyword"
              type="text"
              placeholder="搜索历史提问或关键词..."
              class="sidebar-search-input"
              @keyup.enter="authStore.isAuthenticated.value && loadHistoryData()"
            />
            <button
              v-if="historySearchKeyword"
              class="search-clear-btn"
              type="button"
              title="清空搜索"
              @click="historySearchKeyword = ''; authStore.isAuthenticated.value && loadHistoryData()"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- 历史问题卡片列表 -->
        <div class="sidebar-list">
          <div v-if="!displayHistoryList.length" class="sidebar-empty">
            <span class="empty-icon">📭</span>
            <p class="empty-title">{{ historySearchKeyword ? '未找到相关提问' : '暂无历史提问记录' }}</p>
            <p class="empty-sub">在右侧输入问题，提问将自动在此列表记录～</p>
          </div>

          <div
            v-for="item in displayHistoryList"
            :key="item.id"
            class="history-item-card"
            :class="{ active: selectedHistoryId === item.id }"
            @click="selectHistoryItem(item)"
          >
            <div class="history-item-top">
              <span class="history-item-time">
                🕒 {{ item.created_at || '刚刚' }}
              </span>
              <button
                class="history-item-delete"
                type="button"
                title="删除此条问答记录"
                @click.stop="handleDeleteHistoryItem(item.id)"
              >
                ✕
              </button>
            </div>

            <div class="history-item-question">
              {{ item.question }}
            </div>

            <div class="history-item-tags">
              <span class="mini-agent-tag">{{ agentLabel(item.agent) }}</span>
              <span
                v-if="item.mode"
                class="mini-mode-tag"
                :class="{ cache: item.mode === 'cache', sql: item.mode === 'sql' }"
              >
                {{ modeLabel(item.mode) }}
              </span>
            </div>
          </div>
        </div>

        <!-- 底部快捷工具 -->
        <div v-if="authStore.isAuthenticated.value && historyTotal > 0" class="sidebar-footer">
          <button class="clear-all-link" type="button" @click="handleClearAllUserHistory">
            🗑️ 清空所有提问记录
          </button>
        </div>
      </aside>

      <!-- ===== 右侧：主交互/答案展示与全链路推理详情面板 ===== -->
      <main class="cs-main-panel">
        <!-- 模式 A：点击左侧历史提问，展示该提问的问题、全链路中间推理过程与解答 -->
        <div v-if="selectedHistoryItem" class="history-detail-wrapper">
          <div class="history-detail-header">
            <div class="detail-header-left">
              <span class="detail-badge">📌 历史问答详情</span>
              <span class="detail-time">🕒 提问时间: {{ selectedHistoryItem.created_at }}</span>
            </div>
            <div class="detail-header-right">
              <button class="detail-action-btn followup-btn" type="button" @click="handleFollowUp(selectedHistoryItem)">
                💬 基于此问题追问
              </button>
              <button class="detail-action-btn back-btn" type="button" @click="returnToLiveChat">
                ← 返回实时对话
              </button>
            </div>
          </div>

          <div class="history-detail-scroll">
            <!-- 1. 用户提问展示块 -->
            <div class="history-bubble-box question">
              <div class="bubble-title-bar">
                <span class="bubble-title-left">👤 用户提问</span>
                <span class="bubble-title-right">{{ selectedHistoryItem.created_at }}</span>
              </div>
              <p class="bubble-text-body">{{ selectedHistoryItem.question }}</p>
            </div>

            <!-- 2. AI 深度思考推理流卡片（中间推理过程：无折叠按钮，永久完整展开） -->
            <div class="thought-card is-done">
              <div class="thought-header">
                <div class="thought-header-left">
                  <span class="thought-icon">🧠</span>
                  <span class="thought-title">
                    AI 深度思考推理流 (全链路中间推理过程 · 共 {{ getHistoryReasoningSteps(selectedHistoryItem).length }} 环节)
                  </span>
                  <span class="done-badge">✓ 推理完毕</span>
                </div>
              </div>

              <!-- 中间思考推理步骤终端式流式呈现（完整公开） -->
              <div class="thought-body">
                <pre class="thought-stream-text">{{ formatHistoryReasoningText(selectedHistoryItem) }}</pre>
              </div>
            </div>

            <!-- 3. 客服最终答案展示块 -->
            <div class="history-bubble-box answer">
              <div class="bubble-title-bar">
                <div class="bubble-title-left">
                  <span>🤖 客服解答</span>
                  <span class="agent-chip" :class="selectedHistoryItem.agent">
                    {{ agentLabel(selectedHistoryItem.agent) }}
                  </span>
                  <span
                    v-if="selectedHistoryItem.mode"
                    class="mode-chip"
                    :class="{ 'cache-mode': selectedHistoryItem.mode === 'cache', 'sql-mode': selectedHistoryItem.mode === 'sql' }"
                  >
                    {{ modeLabel(selectedHistoryItem.mode) }}
                  </span>
                </div>
              </div>
              <p class="bubble-text-body">{{ selectedHistoryItem.answer }}</p>
              <div v-if="selectedHistoryItem.trace_summary" class="history-trace-footnote">
                <span class="footnote-label">链路追踪:</span>
                <code>{{ selectedHistoryItem.trace_summary }}</code>
              </div>
            </div>
          </div>
        </div>

        <!-- 模式 B：实时问答模式（打字机逐字输出思考流与回答） -->
        <div v-else ref="listEl" class="chat-list">
          <div v-for="(m, index) in messages" :key="index" class="row" :class="m.role">
            <div class="bubble">
              <!-- 深度思考与推理流卡片（无折叠按钮，永久展开，打字机流式逐字输出） -->
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
                  <pre class="thought-stream-text">{{ m.thinkingText || (m.thinking ? '' : formatThoughtsFallback(m)) }}<span v-if="m.thinking || m.thinkingTyping" class="thought-cursor">▌</span></pre>
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
            </div>
          </div>
        </div>

        <!-- 底部常驻提问操作区（输入问题时自动响应） -->
        <div class="cs-bottom-bar">
          <!-- 推荐提问测试快捷气泡 -->
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
              placeholder="输入您的问题，例如：发票怎么开？我的订单到哪了？（点击左侧可查看历史问题与推理过程）"
              :disabled="sending"
              @compositionstart="composing = true"
              @compositionend="composing = false"
            />
            <button class="send-btn" type="submit" :disabled="!canSend">
              <span v-if="sending" class="spinner"></span>
              {{ sending ? '回复中…' : '发送' }}
            </button>
          </form>
        </div>
      </main>
    </div>
  </section>
</template>

<style scoped>
.cs-card {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 190px);
  min-height: 640px;
  max-height: 900px;
  padding: 16px 20px 14px;
}

.cs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.cs-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cs-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  color: #0f172a;
}

.cs-sub {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cache-stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  font-size: 11.5px;
  padding: 4px 10px;
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

.account-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #475569;
}

.account-pill.logged-in {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e40af;
}

.account-tag {
  background: #dbeafe;
  color: #1d4ed8;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 600;
}

.reset-btn {
  font-size: 12px;
  color: #4f46e5;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.reset-btn:hover {
  background: #e0e7ff;
}

/* ===== 左右主分栏布局 ===== */
.cs-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 16px;
  overflow: hidden;
}

/* 左侧：提问历史列表侧边栏 */
.cs-sidebar {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  overflow: hidden;
}

.sidebar-head {
  padding: 12px 14px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sidebar-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-title {
  font-size: 13.5px;
  font-weight: 700;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sidebar-count-badge {
  font-size: 11px;
  background: #eff6ff;
  color: #2563eb;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid #bfdbfe;
}

.new-chat-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
  background: #4f46e5;
  border: none;
  border-radius: 8px;
  padding: 5px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.new-chat-btn:hover {
  background: #4338ca;
}

.sidebar-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.sidebar-search-input {
  width: 100%;
  padding: 6px 26px 6px 10px;
  font-size: 12.5px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  outline: none;
  background: #f8fafc;
  transition: border-color 0.15s, background 0.15s;
}

.sidebar-search-input:focus {
  border-color: #6366f1;
  background: #ffffff;
}

.search-clear-btn {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-empty {
  padding: 36px 14px;
  text-align: center;
  color: #64748b;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.empty-icon {
  font-size: 32px;
}

.empty-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: #334155;
}

.empty-sub {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
}

.history-item-card {
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 6px;
  user-select: none;
}

.history-item-card:hover {
  border-color: #cbd5e1;
  background: #f1f5f9;
  transform: translateY(-1px);
}

.history-item-card.active {
  background: #eef2ff;
  border-color: #6366f1;
  box-shadow: 0 0 0 1.5px #6366f1;
}

.history-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.history-item-time {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

.history-item-delete {
  background: transparent;
  border: none;
  font-size: 12px;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 4px;
  transition: all 0.15s;
}

.history-item-delete:hover {
  color: #dc2626;
  background: #fee2e2;
}

.history-item-question {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-item-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mini-agent-tag {
  font-size: 10.5px;
  font-weight: 600;
  color: #4338ca;
  background: #e0e7ff;
  padding: 1px 6px;
  border-radius: 4px;
}

.mini-mode-tag {
  font-size: 10px;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  padding: 0 5px;
  border-radius: 4px;
}

.mini-mode-tag.cache {
  color: #047857;
  background: #ecfdf5;
  border-color: #a7f3d0;
  font-weight: 600;
}

.mini-mode-tag.sql {
  color: #0284c7;
  background: #f0f9ff;
  border-color: #bae6fd;
  font-weight: 600;
}

.sidebar-footer {
  padding: 8px 12px;
  background: #ffffff;
  border-top: 1px solid #e2e8f0;
  text-align: center;
}

.clear-all-link {
  border: none;
  background: transparent;
  color: #ef4444;
  font-size: 11.5px;
  cursor: pointer;
  padding: 2px 4px;
  transition: opacity 0.15s;
}

.clear-all-link:hover {
  text-decoration: underline;
}

/* 右侧：主交互/答案展示与全链路推理详情面板 */
.cs-main-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  overflow: hidden;
}

/* 历史记录详情展示包装器 */
.history-detail-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.history-detail-header {
  padding: 10px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-badge {
  font-size: 12.5px;
  font-weight: 700;
  color: #3b82f6;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  padding: 2px 8px;
  border-radius: 6px;
}

.detail-time {
  font-size: 12px;
  color: #64748b;
}

.detail-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-action-btn {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.followup-btn {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
  font-weight: 600;
}

.followup-btn:hover {
  background: #dbeafe;
}

.back-btn {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #475569;
}

.back-btn:hover {
  background: #e2e8f0;
  color: #1e293b;
}

.history-detail-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.history-bubble-box {
  border-radius: 12px;
  padding: 12px 16px;
}

.history-bubble-box.question {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}

.history-bubble-box.answer {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.bubble-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.bubble-title-left {
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}

.history-bubble-box.question .bubble-title-left {
  color: #1d4ed8;
}

.history-bubble-box.answer .bubble-title-left {
  color: #334155;
}

.bubble-title-right {
  font-size: 11.5px;
  color: #64748b;
}

.bubble-text-body {
  font-size: 14.5px;
  line-height: 1.7;
  color: #1e293b;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.history-trace-footnote {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed #e2e8f0;
  font-size: 11px;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.history-trace-footnote code {
  font-family: 'Cascadia Code', Consolas, monospace;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  color: #475569;
}

/* 实时聊天气泡流 */
.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
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
  max-width: 82%;
  padding: 12px 16px;
  border-radius: 14px;
  word-break: break-word;
}

.row.user .bubble {
  color: #fff;
  background: var(--brand, #4f46e5);
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
  color: #4338ca;
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
  color: #64748b;
  border: 1px solid #cbd5e1;
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

.thought-card.is-done {
  border-left-color: #10b981;
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

/* 底部操作条 */
.cs-bottom-bar {
  padding: 10px 16px 14px;
  background: #ffffff;
  border-top: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.prompt-hint {
  font-size: 11.5px;
  color: #64748b;
  font-weight: 600;
}

.prompt-chip {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.prompt-chip:hover {
  background: #eef2ff;
  border-color: #818cf8;
  color: #4f46e5;
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

.error-banner {
  margin: 0;
  padding: 8px 12px;
  font-size: 12.5px;
  line-height: 1.5;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
}

.input-form {
  display: flex;
  gap: 10px;
}

.chat-input {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  font-size: 14px;
  color: #1e293b;
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.chat-input:focus {
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}

.chat-input:disabled {
  background: #f8fafc;
}

.send-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 22px;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  background: #4f46e5;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s, transform 0.05s;
  white-space: nowrap;
}

.send-btn:hover:not(:disabled) {
  background: #4338ca;
}

.send-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.send-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@media (max-width: 768px) {
  .cs-layout {
    flex-direction: column;
  }
  .cs-sidebar {
    width: 100%;
    height: 220px;
  }
  .bubble {
    max-width: 92%;
  }
}
</style>
