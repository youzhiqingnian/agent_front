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
    throw new Error(body?.detail || `请求失败（HTTP ${response.status}）`)
  }
  return response.json()
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

// ===== 智能客服 API =====

export const chatWithCs = (conversationId, message) =>
  request('/api/cs/chat', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, message }),
  })

export const fetchCsCacheStats = () => request('/api/cs/cache/stats')

export const clearCsCache = () =>
  request('/api/cs/cache/clear', {
    method: 'POST',
  })

// 用户问答历史 API (按登录账号隔离)
export const fetchUserQaHistory = (params = {}) => {
  const query = new URLSearchParams()
  if (params.conversation_id) query.append('conversation_id', params.conversation_id)
  if (params.keyword) query.append('keyword', params.keyword)
  if (params.limit) query.append('limit', params.limit)
  if (params.offset) query.append('offset', params.offset)
  const qs = query.toString() ? `?${query.toString()}` : ''
  return request(`/api/cs/history${qs}`)
}

export const fetchUserQaSessions = () => request('/api/cs/sessions')

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

