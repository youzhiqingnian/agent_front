/**
 * SSE 传输层：把「读一条 Server-Sent Events 流」从业务代码里剥出来复用。
 *
 * 只做三件事：按帧解析（含 id:/event: 行）、维护续流游标 lastSeq 并按 seq 去重、
 * 看门狗超时（首字节前算连接超时，之后转空闲超时，避免长任务被硬切）。
 * 鉴权与 401 清态由调用方注入，这里不依赖任何应用层模块。
 */

const DEFAULT_CONNECT_TIMEOUT = 75000
const DEFAULT_IDLE_TIMEOUT = 60000

function parseBlock(block) {
  let dataLines = []
  let eventType = ''
  let lastEventId = ''
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('data:')) {
      dataLines.push(line.replace(/^data:\s?/, ''))
    } else if (line.startsWith('event:')) {
      eventType = line.replace(/^event:\s?/, '')
    } else if (line.startsWith('id:')) {
      lastEventId = line.replace(/^id:\s?/, '')
    }
  }
  if (!dataLines.length) return null
  try {
    const event = JSON.parse(dataLines.join('\n'))
    event.__eventId = lastEventId
    event.__eventType = eventType
    return event
  } catch (err) {
    console.warn('SSE 事件解析失败:', err, dataLines.join('\n'))
    return null
  }
}

/**
 * 读取响应体并派发事件。
 * 返回 { lastSeq, events } —— lastSeq 供调用方持久化，重开页面后据此续流。
 */
export async function readSse(response, handlers = {}, hooks = {}) {
  const { onEvent, onThought, onToken, onDone, onError, onProgress, onTask, onSnapshot, onResumePlan } =
    handlers
  const { onActivity } = hooks
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let lastSeq = -1
  const events = []

  const dispatch = (event) => {
    const seq = typeof event.seq === 'number' ? event.seq : null
    if (seq !== null) {
      // 后端 seq 单调递增：重连时可能重叠下发，重复帧直接丢弃
      if (seq <= lastSeq) return
      lastSeq = seq
    }
    event.lastSeq = lastSeq
    events.push(event)
    if (onEvent) onEvent(event)
    const type = event.type
    if (type === 'thought' && onThought) onThought(event)
    else if (type === 'token' && onToken) onToken(event)
    else if (type === 'done' && onDone) onDone(event)
    else if (type === 'error' && onError) onError(event)
    else if (type === 'task' && onTask) onTask(event)
    else if (type === 'snapshot' && onSnapshot) onSnapshot(event)
    else if (type === 'resume_plan' && onResumePlan) onResumePlan(event)
    else if (type === 'progress' && onProgress) onProgress(event)
    // init / ping 等未知类型静默忽略：新增事件不得影响旧客户端
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (onActivity) onActivity()
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''
      for (const block of blocks) {
        const event = parseBlock(block)
        if (event) dispatch(event)
      }
    }
    if (buffer.trim()) {
      const event = parseBlock(buffer)
      if (event) dispatch(event)
    }
  } finally {
    // 主动释放：调用方 abort 之后 reader 会挂在这里，取消它才能立刻收尾
    try {
      await reader.cancel()
    } catch {
      // 流已结束时 cancel 会报错，忽略
    }
  }
  return { lastSeq, events }
}

/**
 * 打开一条流式请求。返回 { promise, abort }：
 * promise resolve 于整条流读尽，abort() 只断开本地连接——后端任务照常继续跑。
 */
export function openCsStream(url, options = {}, handlers = {}) {
  const {
    method = 'POST',
    body,
    headers = {},
    afterSeq,
    runId,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT,
    onUnauthorized,
    signal: outerSignal,
  } = options

  const controller = new AbortController()
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort(outerSignal.reason)
    else outerSignal.addEventListener('abort', () => controller.abort(outerSignal.reason), { once: true })
  }
  let phase = 'connect'
  let timer = null
  const arm = (nextPhase) => {
    phase = nextPhase
    if (timer) clearTimeout(timer)
    const ms = nextPhase === 'connect' ? connectTimeoutMs : idleTimeoutMs
    timer = setTimeout(() => {
      const message =
        nextPhase === 'connect'
          ? '响应等待超时（已达安全时限），已为您自动解除挂起等待'
          : '长连接空闲超时，任务可能仍在后端执行'
      controller.abort(new Error(message))
    }, ms)
  }
  arm('connect')

  const requestHeaders = { Accept: 'text/event-stream', ...headers }
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
  if (runId && typeof afterSeq === 'number' && afterSeq >= 0) {
    // 后端 _parse_last_event_id 要求 `{run_id}:{seq}` 且前缀须与路径一致，裸 seq 会被忽略
    requestHeaders['Last-Event-ID'] = `${runId}:${afterSeq}`
  }

  const promise = (async () => {
    let response
    try {
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      const message = timeoutMessage(err, phase, connectTimeoutMs)
      if (handlers.onError) handlers.onError({ message })
      throw new Error(message)
    }
    if (response.status === 401) {
      clearTimeout(timer)
      if (onUnauthorized) await onUnauthorized()
      const message = '登录会话已失效，请重新登录'
      if (handlers.onError) handlers.onError({ message })
      throw new Error(message)
    }
    if (!response.ok) {
      clearTimeout(timer)
      const detail = await readErrorDetail(response)
      const message = detail.message || `请求失败（HTTP ${response.status}）`
      if (handlers.onError) handlers.onError({ ...detail, message })
      const err = new Error(message)
      err.reason = detail.reason
      err.attachableRunId = detail.attachable_run_id
      err.runId = detail.run_id
      err.status = response.status
      throw err
    }
    // 首字节已到：从「连不上」切换到「连上了但很久没吐字」
    arm('idle')
    try {
      return await readSse(response, handlers, { onActivity: () => arm('idle') })
    } catch (err) {
      const message = timeoutMessage(err, phase, connectTimeoutMs)
      if (handlers.onError) handlers.onError({ message })
      throw new Error(message)
    } finally {
      clearTimeout(timer)
    }
  })()

  return {
    promise,
    abort(reason) {
      clearTimeout(timer)
      controller.abort(reason || new Error('本地已断开连接'))
    },
  }
}

function timeoutMessage(err, phase, connectTimeoutMs) {
  const aborted = err?.name === 'AbortError'
  const carried = err?.message || err?.reason?.message || ''
  if (aborted || carried.includes('超时')) {
    return carried || '连接超时，请检查后端服务是否正常运行'
  }
  if (phase === 'connect') return `无法连接后端服务（${connectTimeoutMs / 1000}s 内无响应）`
  return carried || '流式数据接收异常'
}

async function readErrorDetail(response) {
  const body = await response.json().catch(() => null)
  const detail = body?.detail
  if (detail && typeof detail === 'object') return detail
  return { message: detail || `请求失败（HTTP ${response.status}）` }
}
