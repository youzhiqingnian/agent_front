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
  const acc = loginForm.account.trim()
  if (!acc) {
    formError.value = '请输入登录账号（支持用户名、邮箱或手机号）'
    return
  }
  if (!loginForm.password) {
    formError.value = '请输入登录密码'
    return
  }

  try {
    await authStore.login(acc, loginForm.password)
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
    formError.value = '两次输入的密码不一致，请核对后重试'
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
  } catch (err) {
    formError.value = err.message || '注册失败，请稍后重试'
  }
}

function switchToRegister() {
  authStore.switchTab('register')
  formError.value = ''
}

function switchToLogin() {
  authStore.switchTab('login')
  formError.value = ''
}
</script>

<template>
  <div class="auth-screen-container">
    <div class="auth-screen-layout">
      <!-- 左侧：系统品牌与架构特性介绍 -->
      <section class="brand-hero-pane">
        <div class="brand-badge-pill">
          <span class="badge-dot"></span>
          <span>系统已就绪 · MySQL 8.0 认证已启用</span>
        </div>

        <div class="brand-header">
          <div class="brand-icon-box">🎓</div>
          <div>
            <h1 class="brand-title">雅思智能助考与 RAG 助理</h1>
            <p class="brand-tagline">全模态知识检索 · 毫秒级语义缓存 · LangGraph 智能多轮客服</p>
          </div>
        </div>

        <div class="feature-card-list">
          <div class="feature-item">
            <div class="feature-icon">🧠</div>
            <div class="feature-text">
              <strong>Milvus & BGE-M3 混合向量检索</strong>
              <p>高维语义嵌入表征，海量考点与真题多模态毫秒级精准命中。</p>
            </div>
          </div>

          <div class="feature-item">
            <div class="feature-icon">⚡</div>
            <div class="feature-text">
              <strong>Redis 语义缓存与极速命中</strong>
              <p>高频意图即时返回，显著降低大模型延迟与接口调用开销。</p>
            </div>
          </div>

          <div class="feature-item">
            <div class="feature-icon">💬</div>
            <div class="feature-text">
              <strong>LangGraph 多智能体协同问答</strong>
              <p>意图分类路由、知识库协同检索与人机回环多轮对话。</p>
            </div>
          </div>

          <div class="feature-item">
            <div class="feature-icon">🔒</div>
            <div class="feature-text">
              <strong>MySQL 8.0 统一鉴权体系</strong>
              <p>JWT 令牌加密鉴权、密码加盐哈希存储与安全审计日志追踪。</p>
            </div>
          </div>
        </div>

        <div class="tech-pill-row">
          <span class="tech-pill">FastAPI</span>
          <span class="tech-pill">Vue 3</span>
          <span class="tech-pill">Milvus 2.4</span>
          <span class="tech-pill">Redis 7</span>
          <span class="tech-pill">LangGraph</span>
          <span class="tech-pill">MySQL 8.0</span>
        </div>
      </section>

      <!-- 右侧：登录与注册交互卡片 -->
      <section class="auth-card-pane">
        <div class="auth-card">
          <!-- 顶部登录/注册分段切换器 -->
          <div class="nav-segment-switch">
            <button
              type="button"
              class="segment-btn"
              :class="{ active: authStore.state.modalTab === 'login' }"
              @click="switchToLogin"
            >
              🔑 用户登录
            </button>
            <button
              type="button"
              class="segment-btn"
              :class="{ active: authStore.state.modalTab === 'register' }"
              @click="switchToRegister"
            >
              📝 新用户注册
            </button>
          </div>

          <!-- 错误提示框 -->
          <div v-if="formError || authStore.state.error" class="alert-error-box">
            <span class="alert-icon">⚠️</span>
            <span>{{ formError || authStore.state.error }}</span>
          </div>

          <!-- ==================== 登录页面 ==================== -->
          <div v-if="authStore.state.modalTab === 'login'" class="form-wrapper">
            <div class="form-header-text">
              <h2>欢迎登录</h2>
              <p>请输入您的账号与密码进入知识库与学习系统</p>
            </div>

            <form class="auth-form" @submit.prevent="handleLogin">
              <div class="input-field-group">
                <label>登录账号</label>
                <div class="input-with-icon">
                  <span class="field-icon">👤</span>
                  <input
                    v-model="loginForm.account"
                    type="text"
                    placeholder="用户名 / 注册邮箱 / 手机号码"
                    autocomplete="username"
                    required
                  />
                </div>
              </div>

              <div class="input-field-group">
                <label>登录密码</label>
                <div class="input-with-icon">
                  <span class="field-icon">🔒</span>
                  <input
                    v-model="loginForm.password"
                    :type="loginForm.showPassword ? 'text' : 'password'"
                    placeholder="请输入账户密码"
                    autocomplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    class="btn-toggle-eye"
                    title="切换密码明文/密文"
                    @click="loginForm.showPassword = !loginForm.showPassword"
                  >
                    {{ loginForm.showPassword ? '👁️' : '🕶️' }}
                  </button>
                </div>
              </div>

              <div class="quick-admin-row">
                <span class="hint-label">快速体验：</span>
                <button type="button" class="btn-quick-fill" @click="fillAdmin">
                  填入测试管理员 (admin / Admin@123456)
                </button>
              </div>

              <button
                type="submit"
                class="btn-primary-submit"
                :disabled="authStore.state.loading"
              >
                <span v-if="authStore.state.loading" class="spinner"></span>
                <span>{{ authStore.state.loading ? '正在验证身份…' : '立即登录进入系统' }}</span>
              </button>
            </form>

            <!-- 登录页进入注册页的入口按钮 -->
            <div class="switch-action-panel">
              <div class="divider-line">
                <span>或者</span>
              </div>
              <div class="register-cta-box">
                <p class="cta-label">还没有账号？点击下方按钮立即注册：</p>
                <button
                  type="button"
                  class="btn-select-register"
                  @click="switchToRegister"
                >
                  ✨ 选择注册新用户
                </button>
              </div>
            </div>
          </div>

          <!-- ==================== 注册页面 ==================== -->
          <div v-else class="form-wrapper">
            <div class="form-header-text">
              <h2>创建新账号</h2>
              <p>填写基础账户信息，免费开启智能备考与专属知识库</p>
            </div>

            <form class="auth-form" @submit.prevent="handleRegister">
              <div class="input-field-group">
                <label>用户名 <span class="required-star">*</span></label>
                <div class="input-with-icon">
                  <span class="field-icon">👤</span>
                  <input
                    v-model="registerForm.username"
                    type="text"
                    placeholder="3-32位字母、数字或下划线"
                    autocomplete="username"
                    required
                  />
                </div>
              </div>

              <div class="input-field-row">
                <div class="input-field-group">
                  <label>登录密码 <span class="required-star">*</span></label>
                  <div class="input-with-icon">
                    <span class="field-icon">🔒</span>
                    <input
                      v-model="registerForm.password"
                      type="password"
                      placeholder="至少 6 位字符"
                      autocomplete="new-password"
                      required
                    />
                  </div>
                </div>

                <div class="input-field-group">
                  <label>确认密码 <span class="required-star">*</span></label>
                  <div class="input-with-icon">
                    <span class="field-icon">🔐</span>
                    <input
                      v-model="registerForm.confirmPassword"
                      type="password"
                      placeholder="再次确认密码"
                      autocomplete="new-password"
                      required
                    />
                  </div>
                </div>
              </div>

              <div class="input-field-row">
                <div class="input-field-group">
                  <label>电子邮箱 (选填)</label>
                  <div class="input-with-icon">
                    <span class="field-icon">✉️</span>
                    <input
                      v-model="registerForm.email"
                      type="email"
                      placeholder="用于接收通知或找回密码"
                    />
                  </div>
                </div>

                <div class="input-field-group">
                  <label>手机号码 (选填)</label>
                  <div class="input-with-icon">
                    <span class="field-icon">📱</span>
                    <input
                      v-model="registerForm.phone"
                      type="tel"
                      placeholder="可用于手机号快捷登录"
                    />
                  </div>
                </div>
              </div>

              <div class="input-field-group">
                <label>个性昵称 (选填)</label>
                <div class="input-with-icon">
                  <span class="field-icon">🏷️</span>
                  <input
                    v-model="registerForm.nickname"
                    type="text"
                    placeholder="您的显示昵称（不填则默认为用户名）"
                  />
                </div>
              </div>

              <button
                type="submit"
                class="btn-primary-submit register-submit"
                :disabled="authStore.state.loading"
              >
                <span v-if="authStore.state.loading" class="spinner"></span>
                <span>{{ authStore.state.loading ? '正在创建账号…' : '完成注册并自动登录' }}</span>
              </button>
            </form>

            <!-- 注册页返回登录页的入口按钮 -->
            <div class="switch-action-panel">
              <div class="divider-line">
                <span>已有账户</span>
              </div>
              <div class="register-cta-box">
                <p class="cta-label">如果您已拥有账号，可直接登录：</p>
                <button
                  type="button"
                  class="btn-select-login"
                  @click="switchToLogin"
                >
                  ⬅️ 返回账号登录
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 底部备案/版权信息 -->
    <footer class="auth-screen-footer">
      <span>雅思智能翻译与 RAG 知识助理系统 · 基于 MySQL 8.0 权限认证与登录审计</span>
    </footer>
  </div>
</template>

<style scoped>
.auth-screen-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: calc(100vh - 120px);
  width: 100%;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.auth-screen-layout {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 36px;
  align-items: center;
  width: 100%;
  max-width: 1060px;
  margin: 0 auto;
}

/* ================= 左侧介绍栏 ================= */
.brand-hero-pane {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-right: 12px;
}

.brand-badge-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(79, 109, 245, 0.1);
  color: var(--brand);
  border: 1px solid rgba(79, 109, 245, 0.2);
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  width: fit-content;
}

.badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 6px var(--ok);
}

.brand-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.brand-icon-box {
  width: 58px;
  height: 58px;
  background: linear-gradient(135deg, #4f6df5 0%, #3b56d4 100%);
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  box-shadow: 0 8px 24px rgba(79, 109, 245, 0.28);
  flex-shrink: 0;
}

.brand-title {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.brand-tagline {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ink-soft);
  line-height: 1.5;
}

.feature-card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feature-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(228, 232, 241, 0.9);
  padding: 12px 16px;
  border-radius: 14px;
  box-shadow: 0 4px 14px rgba(28, 35, 51, 0.03);
  transition: transform 0.2s, box-shadow 0.2s;
}

.feature-item:hover {
  transform: translateX(3px);
  box-shadow: 0 6px 20px rgba(79, 109, 245, 0.08);
}

.feature-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 1px;
}

.feature-text strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 2px;
}

.feature-text p {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.5;
}

.tech-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.tech-pill {
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  padding: 4px 10px;
  border-radius: 999px;
}

/* ================= 右侧卡片栏 ================= */
.auth-card-pane {
  display: flex;
  justify-content: center;
}

.auth-card {
  width: 100%;
  max-width: 460px;
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 24px;
  box-shadow: 0 16px 40px rgba(28, 35, 51, 0.09);
  padding: 28px 24px;
  box-sizing: border-box;
}

/* 顶部选项卡切换 */
.nav-segment-switch {
  display: flex;
  background: #f1f5f9;
  border-radius: 12px;
  padding: 4px;
  margin-bottom: 20px;
  gap: 4px;
}

.segment-btn {
  flex: 1;
  border: none;
  background: transparent;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 600;
  color: #64748b;
  border-radius: 10px;
  transition: all 0.2s;
  text-align: center;
}

.segment-btn.active {
  background: #ffffff;
  color: var(--brand);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* 错误提示 */
.alert-error-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.4;
  animation: shake 0.3s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

.alert-icon {
  font-size: 16px;
  flex-shrink: 0;
}

/* 表单主体 */
.form-header-text {
  margin-bottom: 18px;
}

.form-header-text h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
}

.form-header-text p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ink-soft);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.input-field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.input-field-group label {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.required-star {
  color: #ef4444;
}

.input-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
}

.field-icon {
  position: absolute;
  left: 12px;
  font-size: 14px;
  pointer-events: none;
  opacity: 0.6;
}

.input-with-icon input {
  width: 100%;
  padding: 10px 14px 10px 36px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-size: 13px;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
}

.input-with-icon input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(79, 109, 245, 0.15);
}

.btn-toggle-eye {
  position: absolute;
  right: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.btn-toggle-eye:hover {
  opacity: 1;
}

.quick-admin-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin-top: -4px;
}

.hint-label {
  color: #64748b;
}

.btn-quick-fill {
  border: none;
  background: rgba(79, 109, 245, 0.08);
  color: var(--brand);
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.15s;
}

.btn-quick-fill:hover {
  background: rgba(79, 109, 245, 0.16);
}

.btn-primary-submit {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #4f6df5, #3b56d4);
  color: #ffffff;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(79, 109, 245, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: transform 0.15s, box-shadow 0.15s;
  margin-top: 4px;
}

.btn-primary-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(79, 109, 245, 0.38);
}

.btn-primary-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.register-submit {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 分隔线与注册入口 */
.switch-action-panel {
  margin-top: 20px;
}

.divider-line {
  position: relative;
  text-align: center;
  margin-bottom: 16px;
}

.divider-line::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: #e2e8f0;
}

.divider-line span {
  position: relative;
  background: #ffffff;
  padding: 0 12px;
  font-size: 12px;
  color: #94a3b8;
}

.register-cta-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: center;
}

.cta-label {
  margin: 0;
  font-size: 13px;
  color: #64748b;
}

.btn-select-register {
  width: 100%;
  padding: 10px;
  border: 1px dashed var(--brand);
  background: rgba(79, 109, 245, 0.05);
  color: var(--brand);
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-select-register:hover {
  background: rgba(79, 109, 245, 0.12);
  border-style: solid;
}

.btn-select-login {
  width: 100%;
  padding: 10px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #334155;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-select-login:hover {
  background: #e2e8f0;
  color: #0f172a;
}

/* ================= 底部版权栏 ================= */
.auth-screen-footer {
  margin-top: 28px;
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
}

/* 响应式适配 */
@media (max-width: 860px) {
  .auth-screen-layout {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .brand-hero-pane {
    padding-right: 0;
    text-align: center;
    align-items: center;
  }

  .brand-header {
    flex-direction: column;
  }

  .tech-pill-row {
    justify-content: center;
  }

  .feature-card-list {
    display: none; /* 移动端精简模式 */
  }

  .auth-card {
    max-width: 100%;
  }
}
</style>
