import { openCsStream } from './sse'

const BASE = import.meta.env.VITE_API_BASE ?? ''

export const TOKEN_STORAGE_KEY = 'yasifanyi_access_token'
export const USER_STORAGE_KEY = 'yasifanyi_current_user'

export function getLocalToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || ''
}

export function setLocalAuth(token, user) {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
  if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
}

export function clearLocalAuth() {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
  localStorage.removeItem(USER_STORAGE_KEY)
}

async function request(path, options = {}) {
  let response
  const token = getLocalToken()
  const customHeaders = options.headers || {}
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {}

  try {
    response = await fetch(`${BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
        ...customHeaders,
      },
      ...options,
    })
  } catch {
    throw new Error('无法连接后端服务，请确认已在 backend 目录执行 python run.py')
  }

  if (response.status === 401) {
    // 登录凭证过期或未授权
    clearLocalAuth()
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail || '登录会话已失效，请重新登录')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    const fallback = `请求失败（HTTP ${response.status}）`
    const error = new Error(
      (detail && typeof detail === 'object' ? detail.message || detail.reason : null) ||
        detail ||
        fallback
    )
    if (detail && typeof detail === 'object') Object.assign(error, detail)
    error.status = response.status
    throw error
  }
  return response.json()
}

function authHeaders(extra = {}) {
  const token = getLocalToken()
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }
}

// ===== 用户认证 (Auth) API =====

export const registerUser = (payload) =>
  request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const loginUser = (payload) =>
  request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const fetchMe = () => request('/api/auth/me')

export const logoutUser = () =>
  request('/api/auth/logout', {
    method: 'POST',
  })

export const fetchUserLoginLogs = (limit = 10) =>
  request(`/api/auth/login-logs?limit=${limit}`)

// ===== 系统与单词背诵 API =====

export const fetchHealth = () => request('/api/health')

export const fetchCurrentWord = () => request('/api/words/current')

export const submitJudge = (word, answer) =>
  request('/api/judge', {
    method: 'POST',
    body: JSON.stringify({ word, answer }),
  })

// ===== 客服流式问答与中断恢复 API =====

/**
 * 发起一轮流式问答，返回 { promise, abort }。
 * abort() 只断开本地连接——后端任务照常跑完并落库，重开页面用 attachCsTaskStream 接回。
 */
export function chatWithCsStream(conversationId, message, handlers = {}) {
  return openCsStream(
    `${BASE}/api/cs/chat/stream`,
    {
      method: 'POST',
      body: { conversation_id: conversationId, message },
      headers: authHeaders(),
      onUnauthorized: clearLocalAuth,
    },
    handlers
  )
}

/** 该会话有没有没收尾的任务；追踪不可用时 tracking_available=false，前端退回旧交互。 */
export const fetchPendingCsTasks = (conversationId) => {
  const query = new URLSearchParams()
  if (conversationId) query.append('conversation_id', conversationId)
  const qs = query.toString() ? `?${query.toString()}` : ''
  return request(`/api/cs/tasks/pending${qs}`)
}

export const fetchCsTask = (runId) => request(`/api/cs/tasks/${encodeURIComponent(runId)}`)

/** 用户在弹窗里明确选择后才调用：continue=断点续跑，restart=放弃现场重新提问。 */
export const resumeCsTask = (runId, action = 'continue') =>
  request(`/api/cs/tasks/${encodeURIComponent(runId)}/resume`, {
    method: 'POST',
    body: JSON.stringify({ action, confirm: true }),
  })

export const abandonCsTask = (runId) =>
  request(`/api/cs/tasks/${encodeURIComponent(runId)}/abandon`, { method: 'POST' })

/** 接回任务的实时流：只下发 afterSeq 之后的事件，重连不会重复。 */
export function attachCsTaskStream(runId, afterSeq = -1, handlers = {}) {
  return openCsStream(
    `${BASE}/api/cs/tasks/${encodeURIComponent(runId)}/stream?after_seq=${encodeURIComponent(afterSeq)}`,
    { method: 'GET', headers: authHeaders(), runId, afterSeq, onUnauthorized: clearLocalAuth },
    handlers
  )
}

export const fetchCsCacheStats = () => request('/api/cs/cache/stats')

export const clearCsCache = () =>
  request('/api/cs/cache/clear', {
    method: 'POST',
  })

// 用户问答历史 API (按登录账号隔离；管理员可带 user_id 跨用户查看)
export const fetchUserQaHistory = (params = {}) => {
  const query = new URLSearchParams()
  if (params.conversation_id) query.append('conversation_id', params.conversation_id)
  if (params.keyword) query.append('keyword', params.keyword)
  if (params.limit) query.append('limit', params.limit)
  if (params.offset) query.append('offset', params.offset)
  if (params.user_id !== undefined && params.user_id !== null && params.user_id !== '') {
    query.append('user_id', params.user_id)
  }
  const qs = query.toString() ? `?${query.toString()}` : ''
  return request(`/api/cs/history${qs}`)
}

export const fetchUserQaSessions = (userId) => {
  const qs = userId ? `?user_id=${userId}` : ''
  return request(`/api/cs/sessions${qs}`)
}

export const deleteUserQaRecord = (recordId) =>
  request(`/api/cs/history/${recordId}`, {
    method: 'DELETE',
  })

export const clearUserQaHistory = () =>
  request('/api/cs/history/clear', {
    method: 'POST',
  })

// ===== RAG 知识库 API =====

export const fetchKbStatus = () => request('/api/kb/status')

export const fetchKbDocuments = () => request('/api/kb/documents')

export const fetchKbChunks = (docId) => request(`/api/kb/documents/${docId}/chunks`)

export const deleteKbDocument = (docId) =>
  request(`/api/kb/documents/${docId}`, {
    method: 'DELETE',
  })

export const searchKnowledgeBase = (payload) =>
  request('/api/kb/search', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export async function uploadKbDocument(formData) {
  let response
  const token = getLocalToken()
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {}

  try {
    response = await fetch(`${BASE}/api/kb/upload`, {
      method: 'POST',
      headers: {
        ...authHeader,
      },
      body: formData,
    })
  } catch {
    throw new Error('无法连接后端服务，请确认后端已正常运行')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail || `上传失败（HTTP ${response.status}）`)
  }
  return response.json()
}

// ===== 电商与商品中心 API =====

export const fetchEcommerceCategories = () => request('/api/ecommerce/categories')

export const fetchEcommerceBrands = () => request('/api/ecommerce/brands')

export const fetchEcommerceProducts = (params = {}) => {
  const query = new URLSearchParams()
  if (params.category_id) query.append('category_id', params.category_id)
  if (params.keyword) query.append('keyword', params.keyword)
  if (params.is_hot !== undefined && params.is_hot !== null && params.is_hot !== '') {
    query.append('is_hot', params.is_hot)
  }
  const qs = query.toString() ? `?${query.toString()}` : ''
  return request(`/api/ecommerce/products${qs}`)
}

export const fetchProductDetail = (productId) => request(`/api/ecommerce/products/${productId}`)

export const fetchUserAddresses = (userId) => {
  const qs = userId ? `?user_id=${userId}` : ''
  return request(`/api/ecommerce/addresses${qs}`)
}

export const createOrder = (payload) =>
  request('/api/ecommerce/orders/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const fetchUserOrders = (userId, orderStatus) => {
  const query = new URLSearchParams()
  if (userId) query.append('user_id', userId)
  if (orderStatus !== undefined && orderStatus !== null && orderStatus !== '') {
    query.append('order_status', orderStatus)
  }
  const qs = query.toString() ? `?${query.toString()}` : ''
  return request(`/api/ecommerce/orders${qs}`)
}

export const fetchOrderDetail = (orderNo) => request(`/api/ecommerce/orders/${encodeURIComponent(orderNo)}`)

// ===== Agent 回放系统 API =====

export const fetchCsReplayTurns = (conversationId) =>
  request(`/api/cs/replay/${encodeURIComponent(conversationId)}/turns`)

export const fetchCsReplayEvents = (conversationId, turnId) =>
  request(`/api/cs/replay/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/events`)

export const runCsGhostReplay = (conversationId, turnId) =>
  request(`/api/cs/replay/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/ghost`, {
    method: 'POST',
  })

export const runCsReplayFork = (conversationId, turnId, payload) =>
  request(`/api/cs/replay/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/fork`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const fetchCsReplayModels = () => request('/api/cs/replay/models')

export const fetchAdminUsers = () => request('/api/auth/users')

