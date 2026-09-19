const BASE = import.meta.env.VITE_API_BASE ?? ''

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
  } catch {
    throw new Error('无法连接后端服务，请确认已在 backend 目录执行 python run.py')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail || `请求失败（HTTP ${response.status}）`)
  }
  return response.json()
}

export const fetchHealth = () => request('/api/health')

export const fetchCurrentWord = () => request('/api/words/current')

export const submitJudge = (word, answer) =>
  request('/api/judge', {
    method: 'POST',
    body: JSON.stringify({ word, answer }),
  })

export const chatWithCs = (conversationId, message) =>
  request('/api/cs/chat', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, message }),
  })
