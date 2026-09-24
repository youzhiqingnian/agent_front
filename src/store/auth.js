import { computed, reactive } from 'vue'
import {
  clearLocalAuth,
  fetchMe,
  getLocalToken,
  loginUser,
  logoutUser,
  registerUser,
  setLocalAuth,
  USER_STORAGE_KEY,
} from '../api'

function getInitialUser() {
  const raw = localStorage.getItem(USER_STORAGE_KEY)
  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return null
}

const state = reactive({
  token: getLocalToken(),
  user: getInitialUser(),
  showAuthModal: false,
  modalTab: 'login', // 'login' | 'register'
  showProfileModal: false,
  loading: false,
  error: '',
})

export const authStore = {
  state,
  isAuthenticated: computed(() => !!state.token && !!state.user),
  currentUser: computed(() => state.user),

  openLogin() {
    state.modalTab = 'login'
    state.error = ''
    state.showAuthModal = true
  },

  openRegister() {
    state.modalTab = 'register'
    state.error = ''
    state.showAuthModal = true
  },

  closeModal() {
    state.showAuthModal = false
    state.error = ''
  },

  openProfile() {
    state.showProfileModal = true
  },

  closeProfile() {
    state.showProfileModal = false
  },

  async login(account, password) {
    state.loading = true
    state.error = ''
    try {
      const res = await loginUser({ account, password })
      state.token = res.access_token
      state.user = res.user
      setLocalAuth(res.access_token, res.user)
      state.showAuthModal = false
      return res.user
    } catch (err) {
      state.error = err.message || '登录失败'
      throw err
    } finally {
      state.loading = false
    }
  },

  async register(payload) {
    state.loading = true
    state.error = ''
    try {
      const res = await registerUser(payload)
      state.token = res.access_token
      state.user = res.user
      setLocalAuth(res.access_token, res.user)
      state.showAuthModal = false
      return res.user
    } catch (err) {
      state.error = err.message || '注册失败'
      throw err
    } finally {
      state.loading = false
    }
  },

  async logout() {
    try {
      await logoutUser()
    } catch {
      // 忽略登出失败，前端一律清空
    } finally {
      state.token = ''
      state.user = null
      state.showProfileModal = false
      clearLocalAuth()
    }
  },

  async initAuth() {
    if (!state.token) return
    try {
      const user = await fetchMe()
      state.user = user
      setLocalAuth(state.token, user)
    } catch {
      state.token = ''
      state.user = null
      clearLocalAuth()
    }
  },
}
