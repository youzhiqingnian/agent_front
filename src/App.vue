<script setup>
import { computed, onMounted, ref } from 'vue'
import WordCard from './components/WordCard.vue'
import JudgeResult from './components/JudgeResult.vue'
import CustomerService from './components/CustomerService.vue'
import KnowledgeBase from './components/KnowledgeBase.vue'
import AuthModal from './components/AuthModal.vue'
import UserProfileModal from './components/UserProfileModal.vue'
import { fetchCurrentWord, fetchHealth, submitJudge } from './api'
import { authStore } from './store/auth'

const view = ref('kb')
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
  // 初始化登录认证状态
  authStore.initAuth()

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
  <!-- 登录注册模态框 -->
  <AuthModal />

  <!-- 用户个人中心与登录审计日志模态框 -->
  <UserProfileModal />

  <header class="app-head">
    <div>
      <div class="title-row">
        <h1>RAG 知识库与智能助理</h1>
        <span class="status" :class="{ offline: !!loadError }">{{ statusText }}</span>
      </div>
      <p class="subtitle">MySQL 8.0 用户认证 · Milvus 向量库 · BGE-M3 嵌入 · Redis 语义缓存 · LangGraph 智能客服</p>
    </div>

    <!-- 用户登录状态控制栏 -->
    <div class="user-bar">
      <!-- 已登录 -->
      <div v-if="authStore.isAuthenticated.value" class="user-logged-box" @click="authStore.openProfile()">
        <img
          class="nav-avatar"
          :src="authStore.state.user?.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=user'"
          alt="avatar"
        />
        <div class="nav-user-info">
          <span class="nav-nickname">{{ authStore.state.user?.nickname || authStore.state.user?.username }}</span>
          <span class="nav-role" :class="authStore.state.user?.role">
            {{ authStore.state.user?.role === 'admin' ? '管理员' : '普通用户' }}
          </span>
        </div>
        <button class="nav-logout-btn" type="button" title="退出登录" @click.stop="authStore.logout()">
          🚪
        </button>
      </div>

      <!-- 未登录 -->
      <div v-else class="user-guest-box">
        <button class="auth-trigger-btn login-btn" type="button" @click="authStore.openLogin()">
          登录
        </button>
        <button class="auth-trigger-btn register-btn" type="button" @click="authStore.openRegister()">
          注册
        </button>
      </div>
    </div>
  </header>

  <p v-if="loadError" class="error-banner">{{ loadError }}</p>

  <nav class="tabs">
    <button class="tab" :class="{ active: view === 'kb' }" type="button" @click="view = 'kb'">
      🧠 RAG 知识库
    </button>
    <button class="tab" :class="{ active: view === 'cs' }" type="button" @click="view = 'cs'">
      💬 智能客服
    </button>
    <button class="tab" :class="{ active: view === 'vocab' }" type="button" @click="view = 'vocab'">
      📖 背单词判定
    </button>
  </nav>

  <!-- 视图展示 -->
  <KnowledgeBase v-if="view === 'kb'" />

  <CustomerService v-else-if="view === 'cs'" />

  <main v-else-if="view === 'vocab' && card">
    <WordCard :card="card" :loading="loading" @submit="handleSubmit" />
    <p v-if="submitError" class="error-banner">{{ submitError }}</p>
    <JudgeResult v-if="result" :result="result" />
  </main>

  <div v-else-if="view === 'vocab' && !loadError" class="card loading-card">正在加载题目…</div>
</template>

<style scoped>
.app-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
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
  padding: 4px 12px;
  white-space: nowrap;
}

.status.offline {
  color: var(--bad);
  background: #fdeaea;
}

/* 用户状态栏 */
.user-bar {
  display: flex;
  align-items: center;
}

.user-guest-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.auth-trigger-btn {
  padding: 8px 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
  cursor: pointer;
}

.login-btn {
  border: 1px solid var(--line);
  background: #ffffff;
  color: var(--ink);
}

.login-btn:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.register-btn {
  border: none;
  background: var(--brand);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(79, 109, 245, 0.25);
}

.register-btn:hover {
  background: var(--brand-dark);
}

.user-logged-box {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border: 1px solid var(--line);
  padding: 6px 12px;
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: all 0.2s;
}

.user-logged-box:hover {
  border-color: #cbd5e1;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
}

.nav-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid #e0e7ff;
}

.nav-user-info {
  display: flex;
  flex-direction: column;
}

.nav-nickname {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.2;
}

.nav-role {
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
}

.nav-role.admin {
  color: #b45309;
}

.nav-role.user {
  color: #0369a1;
}

.nav-logout-btn {
  border: none;
  background: transparent;
  padding: 4px;
  font-size: 15px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-logout-btn:hover {
  opacity: 1;
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
