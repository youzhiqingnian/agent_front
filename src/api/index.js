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

//export const chatWithCs = (conversationId, message) =>
//  request('/api/cs/chat', {
//    method: 'POST',
//    body: JSON.stringify({ conversation_id: conversationId, message }),
//  })

export async function chatWithCsStream(conversationId, message, { onThought, onToken, onDone, onError } = {}) {
  const token = getLocalToken()
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {}

  // 前端看门狗超时（75秒），防止网络底层假死或后端彻底未响应时前端永久停留在转圈状态
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('响应等待超时（已达安全时限75秒），已为您自动解除挂起等待'))
  }, 75000)

  let response
  try {
    response = await fetch(`${BASE}/api/cs/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify({ conversation_id: conversationId, message }),
      signal: controller.signal,
    })
  } catch (fetchErr) {
    clearTimeout(timeoutId)
    const isTimeout = fetchErr?.name === 'AbortError' || fetchErr?.message?.includes('超时')
    const errMsg = isTimeout ? (fetchErr.message || '响应等待超时，已自动解除等待状态') : '无法连接后端服务，请确认后端已启动'
    const err = new Error(errMsg)
    if (onError) onError({ message: errMsg })
    throw err
  }

  if (response.status === 401) {
    clearTimeout(timeoutId)
    clearLocalAuth()
    const err = new Error('登录会话已失效，请重新登录')
    if (onError) onError({ message: err.message })
    throw err
  }

  if (!response.ok) {
    clearTimeout(timeoutId)
    const body = await response.json().catch(() => null)
    const err = new Error(body?.detail || `请求失败（HTTP ${response.status}）`)
    if (onError) onError({ message: err.message })
    throw err
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const processBlock = (block) => {
    const trimmed = block.trim()
    if (!trimmed) return
    const lines = trimmed.split(/\r?\n/)
    let dataContent = ''
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const chunk = line.replace(/^data:\s?/, '')
        dataContent += (dataContent ? '\n' : '') + chunk
      }
    }
    if (!dataContent) return
    try {
      const event = JSON.parse(dataContent)
      if (event.type === 'thought' && onThought) onThought(event)
      else if (event.type === 'token' && onToken) onToken(event)
      else if (event.type === 'done' && onDone) onDone(event)
      else if (event.type === 'error' && onError) onError(event)
      else if (event.type === 'ping') {
        // 心跳探活事件：自动保持长连接活跃，静默忽略以防干扰 UI
      }
    } catch (e) {
      console.warn('Failed to parse SSE event:', e, dataContent)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''

      for (const block of blocks) {
        processBlock(block)
      }
    }
    if (buffer.trim()) {
      processBlock(buffer)
    }
  } catch (err) {
    const isTimeout = err?.name === 'AbortError' || err?.message?.includes('超时')
    const errMsg = isTimeout ? (err.message || '响应等待超时，已自动解除等待') : (err.message || '流式数据接收异常')
    if (onError) onError({ message: errMsg })
    throw new Error(errMsg)
  } finally {
    clearTimeout(timeoutId)
  }
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

