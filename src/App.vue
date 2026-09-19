<script setup>
import { computed, onMounted, ref } from 'vue'
import WordCard from './components/WordCard.vue'
import JudgeResult from './components/JudgeResult.vue'
import CustomerService from './components/CustomerService.vue'
import { fetchCurrentWord, fetchHealth, submitJudge } from './api'

const view = ref('vocab')
const card = ref(null)
const health = ref(null)
const result = ref(null)
const loading = ref(false)
const loadError = ref('')
const submitError = ref('')

const statusText = computed(() => {
  if (loadError.value) return '后端未连接'
  if (!health.value) return '检测中…'
  return health.value.llm_enabled ? `大模型已接入 · ${health.value.llm_model}` : '离线规则模式（未配置 LLM_API_KEY）'
})

onMounted(async () => {
  try {
    const [wordCard, healthInfo] = await Promise.all([fetchCurrentWord(), fetchHealth()])
    card.value = wordCard
    health.value = healthInfo
  } catch (error) {
    loadError.value = error.message
  }
})

async function handleSubmit(answer) {
  if (!card.value) return
  submitError.value = ''
  result.value = null
  loading.value = true
  try {
    result.value = await submitJudge(card.value.word, answer)
  } catch (error) {
    submitError.value = error.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <header class="app-head">
    <div>
      <h1>背单词 Demo</h1>
      <p class="subtitle">Vue 3 + FastAPI + LangGraph 释义判定</p>
    </div>
    <span class="status" :class="{ offline: !!loadError }">{{ statusText }}</span>
  </header>

  <p v-if="loadError" class="error-banner">{{ loadError }}</p>

  <nav class="tabs">
    <button class="tab" :class="{ active: view === 'vocab' }" type="button" @click="view = 'vocab'">
      背单词判定
    </button>
    <button class="tab" :class="{ active: view === 'cs' }" type="button" @click="view = 'cs'">
      智能客服
    </button>
  </nav>

  <main v-if="view === 'vocab' && card">
    <WordCard :card="card" :loading="loading" @submit="handleSubmit" />
    <p v-if="submitError" class="error-banner">{{ submitError }}</p>
    <JudgeResult v-if="result" :result="result" />
  </main>

  <div v-else-if="view === 'vocab' && !loadError" class="card loading-card">正在加载题目…</div>

  <CustomerService v-else />
</template>

<style scoped>
.app-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.app-head h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--ink-soft);
}

.status {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ok);
  background: #e8f7ee;
  border-radius: 999px;
  padding: 6px 14px;
  white-space: nowrap;
}

.status.offline {
  color: var(--bad);
  background: #fdeaea;
}

.tabs {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 20px;
  padding: 4px;
  background: #e9edf6;
  border-radius: 999px;
}

.tab {
  border: none;
  background: transparent;
  color: var(--ink-soft);
  font-size: 14px;
  font-weight: 600;
  padding: 8px 20px;
  border-radius: 999px;
  transition: background 0.15s, color 0.15s;
}

.tab.active {
  color: #fff;
  background: var(--brand);
}

.error-banner {
  margin: 0 0 16px;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--bad);
  background: #fdeaea;
  border-radius: 12px;
}

.loading-card {
  color: var(--ink-soft);
  font-size: 14px;
  text-align: center;
}
</style>
