<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { chatWithCs, clearCsCache, fetchCsCacheStats } from '../api'

const STORAGE_KEY = 'cs-chat-session'

const AGENT_LABELS = {
  order_agent: '订单专员',
  product_agent: '商品咨询',
  aftersale_agent: '售后专员',
  chitchat_agent: '通用客服',
  security_guard: '安全风控',
  clarification_agent: '信息澄清',
  semantic_cache: '⚡ 语义缓存',
}

const MODE_LABELS = {
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
  messages.value.push({ role: 'user', content: text })
  sending.value = true
  scrollToBottom()
  try {
    const res = await chatWithCs(conversationId.value, text)
    conversationId.value = res.conversation_id
    messages.value.push({
      role: 'assistant',
      content: res.reply,
      agent: res.agent,
      mode: res.mode,
      trace: res.trace || [],
    })
  } catch (err) {
    error.value = err.message
    messages.value.push({
      role: 'assistant',
      content: '抱歉，消息发送失败，请稍后重试。',
      failed: true,
    })
  } finally {
    sending.value = false
    scrollToBottom()
    refreshCacheStats()
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

watch([messages, conversationId], saveSession, { deep: true })

onMounted(() => {
  scrollToBottom()
  refreshCacheStats()
})
</script>

<template>
  <section class="card cs-card">
    <header class="cs-head">
      <div>
        <h2 class="cs-title">智能客服</h2>
        <p class="cs-sub">LangGraph 多 Agent · Supervisor 分派 · Redis 语义缓存</p>
      </div>
      <div class="head-actions">
        <div v-if="cacheStats && cacheStats.connected" class="cache-stat-pill" :title="'Redis 地址: ' + cacheStats.redis_host + ':' + cacheStats.redis_port + ' | 相似度阈值: ' + cacheStats.similarity_threshold">
          <span class="cache-stat-dot"></span>
          <span>⚡ 语义缓存: {{ cacheStats.total_cached }}条已存</span>
          <span class="cache-stat-divider">·</span>
          <span>命中 {{ cacheStats.hits }} 次</span>
          <button class="cache-clear-link" type="button" title="清空语义缓存数据" @click="handleClearCache">清空</button>
        </div>
        <button class="reset-btn" type="button" @click="resetSession">新会话</button>
      </div>
    </header>

    <div ref="listEl" class="chat-list">
      <div v-for="(m, index) in messages" :key="index" class="row" :class="m.role">
        <div class="bubble">
          <p class="text">{{ m.content }}</p>
          <div v-if="m.role === 'assistant' && (m.agent || m.mode)" class="meta-line">
            <span
              class="agent-chip"
              :class="{
                'security-chip': m.agent === 'security_guard',
                'clarification-chip': m.agent === 'clarification_agent',
                'cache-chip': m.agent === 'semantic_cache',
              }"
            >
              {{ agentLabel(m.agent) }}
            </span>
            <span
              v-if="m.mode"
              class="mode-chip"
              :class="{ 'cache-mode': m.mode === 'cache' }"
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

      <div v-if="sending" class="row assistant">
        <div class="bubble typing">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
      </div>
    </div>

    <!-- 语义缓存推荐提问与测试快捷气泡 -->
    <div class="quick-prompts">
      <span class="prompt-hint">💡 语义缓存推荐测试：</span>
      <button type="button" class="prompt-chip" @click="usePrompt('请问易学商城购买商品后如何申请开具发票？')">
        1. 发票申请 (首问·写入缓存)
      </button>
      <button type="button" class="prompt-chip" @click="usePrompt('在商城买完东西之后怎么开发票？')">
        2. 发票咨询 (相似提问·秒级命中)
      </button>
      <button type="button" class="prompt-chip" @click="usePrompt('请问商城的退换货流程和运费政策是怎样的？')">
        3. 退换货政策
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
</style>
