<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { chatWithCs } from '../api'

const STORAGE_KEY = 'cs-chat-session'

const AGENT_LABELS = {
  order_agent: '订单专员',
  product_agent: '商品咨询',
  aftersale_agent: '售后专员',
  chitchat_agent: '通用客服',
}

const MODE_LABELS = {
  llm: '大模型',
  rule: '规则兜底',
}

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
  }
}

function onSubmit() {
  if (!composing.value) send()
}

function toggleTrace(index) {
  openTrace.value = openTrace.value === index ? -1 : index
}

function agentLabel(agent) {
  return AGENT_LABELS[agent] || agent || '客服'
}

function modeLabel(mode) {
  return MODE_LABELS[mode] || mode || ''
}

watch([messages, conversationId], saveSession, { deep: true })

onMounted(scrollToBottom)
</script>

<template>
  <section class="card cs-card">
    <header class="cs-head">
      <div>
        <h2 class="cs-title">智能客服</h2>
        <p class="cs-sub">LangGraph 多 Agent · Supervisor 分派</p>
      </div>
      <button class="reset-btn" type="button" @click="resetSession">新会话</button>
    </header>

    <div ref="listEl" class="chat-list">
      <div v-for="(m, index) in messages" :key="index" class="row" :class="m.role">
        <div class="bubble">
          <p class="text">{{ m.content }}</p>
          <div v-if="m.role === 'assistant' && (m.agent || m.mode)" class="meta-line">
            <span class="agent-chip">{{ agentLabel(m.agent) }}</span>
            <span v-if="m.mode" class="mode-chip">{{ modeLabel(m.mode) }}</span>
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

    <p v-if="error" class="error-banner">{{ error }}</p>

    <form class="input-form" @submit.prevent="onSubmit">
      <input
        v-model="input"
        class="chat-input"
        type="text"
        autocomplete="off"
        placeholder="输入您的问题，例如：我的订单到哪了？"
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

.mode-chip {
  font-size: 11.5px;
  color: var(--ink-soft);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 1.5px 10px;
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

.input-form {
  display: flex;
  gap: 10px;
  margin-top: 14px;
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
