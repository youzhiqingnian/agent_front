<script setup>
import { reactive, ref } from 'vue'
import { authStore } from '../store/auth'

const loginForm = reactive({
  account: '',
  password: '',
  showPassword: false,
})

const registerForm = reactive({
  username: '',
  password: '',
  confirmPassword: '',
  email: '',
  phone: '',
  nickname: '',
  showPassword: false,
})

const formError = ref('')

function fillAdmin() {
  loginForm.account = 'admin'
  loginForm.password = 'Admin@123456'
  formError.value = ''
}

async function handleLogin() {
  formError.value = ''
  if (!loginForm.account.trim()) {
    formError.value = '请输入登录账号（用户名、邮箱或手机号）'
    return
  }
  if (!loginForm.password) {
    formError.value = '请输入密码'
    return
  }

  try {
    await authStore.login(loginForm.account.trim(), loginForm.password)
    loginForm.password = ''
  } catch (err) {
    formError.value = err.message || '登录失败，请检查账号密码'
  }
}

async function handleRegister() {
  formError.value = ''
  const u = registerForm.username.trim()
  const p = registerForm.password
  const cp = registerForm.confirmPassword

  if (!u) {
    formError.value = '请输入用户名'
    return
  }
  if (u.length < 3) {
    formError.value = '用户名长度不能少于 3 个字符'
    return
  }
  if (!p) {
    formError.value = '请输入密码'
    return
  }
  if (p.length < 6) {
    formError.value = '密码长度不能少于 6 个字符'
    return
  }
  if (p !== cp) {
    formError.value = '两次输入的密码不一致，请核对'
    return
  }

  try {
    await authStore.register({
      username: u,
      password: p,
      email: registerForm.email.trim() || undefined,
      phone: registerForm.phone.trim() || undefined,
      nickname: registerForm.nickname.trim() || undefined,
    })
    // 注册成功自动登录并关闭
  } catch (err) {
    formError.value = err.message || '注册失败'
  }
}
</script>

<template>
  <div v-if="authStore.state.showAuthModal" class="modal-backdrop" @click.self="authStore.closeModal()">
    <div class="auth-card">
      <button class="close-btn" type="button" @click="authStore.closeModal()">✕</button>

      <div class="auth-tabs">
        <button
          class="tab-btn"
          :class="{ active: authStore.state.modalTab === 'login' }"
          type="button"
          @click="authStore.state.modalTab = 'login'; formError = ''"
        >
          用户登录
        </button>
        <button
          class="tab-btn"
          :class="{ active: authStore.state.modalTab === 'register' }"
          type="button"
          @click="authStore.state.modalTab = 'register'; formError = ''"
        >
          免费注册
        </button>
      </div>

      <!-- 错误提示 -->
      <div v-if="formError || authStore.state.error" class="error-box">
        ⚠️ {{ formError || authStore.state.error }}
      </div>

      <!-- 登录表单 -->
      <form v-if="authStore.state.modalTab === 'login'" class="form-body" @submit.prevent="handleLogin">
        <div class="form-group">
          <label>登录账号</label>
          <input
            v-model="loginForm.account"
            type="text"
            placeholder="用户名 / 注册邮箱 / 手机号"
            autocomplete="username"
            required
          />
        </div>

        <div class="form-group">
          <label>登录密码</label>
          <div class="pwd-input-wrap">
            <input
              v-model="loginForm.password"
              :type="loginForm.showPassword ? 'text' : 'password'"
              placeholder="请输入账户密码"
              autocomplete="current-password"
              required
            />
            <button
              type="button"
              class="toggle-pwd-btn"
              @click="loginForm.showPassword = !loginForm.showPassword"
            >
              {{ loginForm.showPassword ? '👁️' : '🔒' }}
            </button>
          </div>
        </div>

        <div class="quick-admin">
          <span>测试账号：</span>
          <button type="button" class="link-btn" @click="fillAdmin">填入管理员 (admin / Admin@123456)</button>
        </div>

        <button class="submit-btn" type="submit" :disabled="authStore.state.loading">
          {{ authStore.state.loading ? '正在验证登录…' : '立即登录' }}
        </button>

        <p class="switch-hint">
          还没有账号？
          <a href="javascript:void(0)" @click="authStore.state.modalTab = 'register'; formError = ''">立即注册一个</a>
        </p>
      </form>

      <!-- 注册表单 -->
      <form v-else class="form-body" @submit.prevent="handleRegister">
        <div class="form-group">
          <label>用户名 <span class="req">*</span></label>
          <input
            v-model="registerForm.username"
            type="text"
            placeholder="3-32位字母、数字或下划线"
            autocomplete="username"
            required
          />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>登录密码 <span class="req">*</span></label>
            <input
              v-model="registerForm.password"
              type="password"
              placeholder="至少 6 位字符"
              autocomplete="new-password"
              required
            />
          </div>
          <div class="form-group">
            <label>确认密码 <span class="req">*</span></label>
            <input
              v-model="registerForm.confirmPassword"
              type="password"
              placeholder="再次输入密码"
              autocomplete="new-password"
              required
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>电子邮箱 (选填)</label>
            <input
              v-model="registerForm.email"
              type="email"
              placeholder="用于找回密码或接收通知"
            />
          </div>
          <div class="form-group">
            <label>手机号码 (选填)</label>
            <input
              v-model="registerForm.phone"
              type="tel"
              placeholder="支持手机号快捷登录"
            />
          </div>
        </div>

        <div class="form-group">
          <label>个性昵称 (选填)</label>
          <input
            v-model="registerForm.nickname"
            type="text"
            placeholder="您的对外显示名称"
          />
        </div>

        <button class="submit-btn" type="submit" :disabled="authStore.state.loading">
          {{ authStore.state.loading ? '正在创建账号…' : '完成注册并登录' }}
        </button>

        <p class="switch-hint">
          已有账号？
          <a href="javascript:void(0)" @click="authStore.state.modalTab = 'login'; formError = ''">去登录</a>
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
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

.auth-card {
  position: relative;
  width: 100%;
  max-width: 460px;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
  padding: 32px 28px 24px;
}

.close-btn {
  position: absolute;
  top: 18px;
  right: 18px;
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
  transition: all 0.2s;
}

.close-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.auth-tabs {
  display: flex;
  border-bottom: 2px solid #f1f5f9;
  margin-bottom: 20px;
  gap: 16px;
}

.tab-btn {
  border: none;
  background: transparent;
  padding: 10px 4px 12px;
  font-size: 18px;
  font-weight: 600;
  color: #94a3b8;
  position: relative;
  transition: color 0.2s;
}

.tab-btn.active {
  color: #3b82f6;
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  right: 0;
  height: 2px;
  background: #3b82f6;
  border-radius: 2px;
}

.error-box {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  margin-bottom: 16px;
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.req {
  color: #ef4444;
}

.form-group input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
}

.form-group input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.pwd-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.pwd-input-wrap input {
  padding-right: 40px;
}

.toggle-pwd-btn {
  position: absolute;
  right: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 15px;
  opacity: 0.7;
}

.toggle-pwd-btn:hover {
  opacity: 1;
}

.quick-admin {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: #64748b;
  margin-top: -6px;
}

.link-btn {
  border: none;
  background: transparent;
  color: #2563eb;
  padding: 0;
  text-decoration: underline;
  font-size: 12px;
}

.submit-btn {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: #ffffff;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.3);
  transition: transform 0.15s, box-shadow 0.15s;
  margin-top: 6px;
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.4);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.switch-hint {
  text-align: center;
  font-size: 13px;
  color: #64748b;
  margin: 4px 0 0;
}

.switch-hint a {
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
}

.switch-hint a:hover {
  text-decoration: underline;
}
</style>
