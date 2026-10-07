/**
 * 打字机流式渲染：把「思考推理流 + 作答正文」的双轨逐字输出从组件里剥出来复用。
 *
 * 实时提问、断线重连续流(attach)、快照重建(hydrate)走的是同一套缓冲与定时器，
 * 差别只在于数据来源：前者收 live 事件，后者先 hydrate 再挂 live handler。
 */

const TICK_MS = 12

function stageLine(stage) {
  const marker = stage.status === 'running' ? '▸' : stage.status === 'error' ? '⚠' : '✓'
  const detail = stage.detail ? ` — ${stage.detail}` : ''
  return `${marker} ${stage.title || stage.node}${detail}\n`
}

/** 阶段数组 → 思考流文本：续流前的快照回填用同一套渲染口径。 */
export function stagesToThinkingText(stages = []) {
  return stages.map((s) => stageLine(s)).join('')
}

export function createTypewriter(msg, options = {}) {
  const { scrollToBottom = () => {}, onDone: doneHook, onError: errorHook } = options

  let thoughtBuffer = ''
  let tokenBuffer = ''
  let timer = null
  let streamDone = false
  let pendingDone = null
  let answering = false
  let runId = ''
  let lastSeq = -1

  const start = () => {
    if (!timer) timer = setInterval(flush, TICK_MS)
  }

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    msg.thinkingTyping = false
    msg.typing = false
  }

  function flush() {
    let hasWork = false

    // 思考流严格先于回答正文打完，否则两段文字会互相插队
    if (thoughtBuffer.length > 0) {
      hasWork = true
      const speedBoost = !answering && tokenBuffer.length > 0 ? 2 : 1
      const step =
        thoughtBuffer.length > 45
          ? 3 * speedBoost
          : thoughtBuffer.length > 15
            ? 2 * speedBoost
            : 1
      msg.thinkingText += thoughtBuffer.slice(0, step)
      thoughtBuffer = thoughtBuffer.slice(step)
      msg.thinkingTyping = true
    } else {
      msg.thinkingTyping = false
    }

    if (thoughtBuffer.length === 0 && tokenBuffer.length > 0) answering = true

    if (answering && tokenBuffer.length > 0) {
      hasWork = true
      msg.thinking = false
      msg.typing = true
      const step = tokenBuffer.length > 50 ? 3 : tokenBuffer.length > 20 ? 2 : 1
      msg.content += tokenBuffer.slice(0, step)
      tokenBuffer = tokenBuffer.slice(step)
    }

    if (hasWork) {
      scrollToBottom()
      return
    }
    if (streamDone) {
      // 流已结束且两条队列都排空：此刻才能落终态标记，否则光标会先于文字消失
      stop()
      msg.thinking = false
      if (!msg.content && pendingDone?.reply) msg.content = pendingDone.reply
      scrollToBottom()
    }
  }

  const track = (event) => {
    if (typeof event.seq === 'number' && event.seq > lastSeq) lastSeq = event.seq
    if (event.run_id) runId = event.run_id
  }

  const seedOpening = () => {
    thoughtBuffer += '▸ 🚀 正在启动智能客服 Agent 思考流... — 初始化多智能体协同流水线与会话上下文\n'
    thoughtBuffer += '▸ 🛡️ 正在进行输入安全风控审查... — 检测提示词注入、角色越狱与指令合规性\n'
    msg.thoughts.push(
      {
        node: 'workflow_start',
        title: '🚀 正在启动智能客服 Agent 思考流...',
        detail: '初始化多智能体协同流水线与会话上下文',
        status: 'done',
      },
      {
        node: 'security_check',
        title: '🛡️ 正在进行输入安全风控审查...',
        detail: '检测提示词注入、角色越狱与指令合规性',
        status: 'running',
      }
    )
    start()
  }

  const onThought = (th) => {
    track(th)
    const index = msg.thoughts.findIndex((t) => t.node === th.node)
    if (index >= 0) {
      msg.thoughts[index] = { ...msg.thoughts[index], title: th.title, detail: th.detail, status: th.status }
    } else {
      msg.thoughts.push({ node: th.node, title: th.title, detail: th.detail, status: th.status })
    }
    if (th.node === 'workflow_start') return

    thoughtBuffer += stageLine({ title: th.title, detail: th.detail, status: th.status })
    start()
    scrollToBottom()
  }

  const onToken = (tok) => {
    track(tok)
    tokenBuffer += tok.content
    start()
  }

  const onTask = (evt) => {
    track(evt)
    runId = evt.run_id || runId
    // 气泡与 run 一一对应，重开页面时才认得出「这就是那条任务的气泡」
    msg.runId = runId
  }

  const onDone = (doneEvt) => {
    track(doneEvt)
    streamDone = true
    pendingDone = doneEvt
    msg.agent = doneEvt.agent
    msg.mode = doneEvt.mode
    msg.trace = doneEvt.trace || []
    msg.interruptedNote = ''
    start()
    if (doneHook) doneHook(doneEvt)
  }

  const onError = (errEvt) => {
    track(errEvt)
    // 后端明确报了中断：半截答案留着，但气泡不再转圈，并标出中断位置
    stop()
    msg.thinking = false
    msg.interruptedNote = '⏸ 这次任务在中途异常中断，可以在下次打开时选择继续'
    if (errorHook) errorHook(errEvt)
  }

  /** 游标失效或本进程已无执行体时用任务行整体重建，而不是报错。 */
  const onSnapshot = (evt) => {
    track(evt)
    runId = evt.run_id || runId
    const stages = Array.isArray(evt.stages) ? evt.stages : []
    if (stages.length) {
      msg.thoughts = stages.map((s) => ({
        node: s.node,
        title: s.title,
        detail: s.detail,
        status: s.status,
      }))
      msg.thinkingText = stagesToThinkingText(stages)
    }
    if (evt.partial_answer && !msg.content) msg.content = evt.partial_answer
    if (evt.reply && !msg.content) msg.content = evt.reply
    if (evt.interrupted) msg.interruptedNote = '⏸ 上次任务在此中断'
    scrollToBottom()
  }

  /**
   * 断点续跑开始：上一次尝试已经打出来的字不再并入新尝试的正文，
   * 否则用户会读到两遍开头拼在一起的答案。
   */
  const onResumePlan = (evt) => {
    track(evt)
    // 冻结上一个 attempt 的半截正文：不清空的话，done 里的完整回复会被它挡住
    if (msg.content) {
      msg.abandonedContent = msg.content
      msg.content = ''
    }
    tokenBuffer = ''
    answering = false
    streamDone = false
    pendingDone = null
    const line =
      evt.will_rerun === false
        ? `✅ 上次其实已经答完，只是没能送达：直接补发完整回复，本次不重新调用大模型\n`
        : `♻️ 从断点恢复：正在重跑「${(evt.pending_nodes || []).join('、') || '中断步骤'}」——之前已完成的步骤不会重新执行，本步骤的大模型调用会重来一次，措辞可能与上次略有差异\n`
    thoughtBuffer += line
    msg.interruptedNote = ''
    start()
    scrollToBottom()
  }

  /**
   * 连接结束却始终没等到 done：已收到的内容一次性落地，气泡绝不能再转圈。
   * 缓冲里剩下的字若不倒出来，用户看到的就是永久卡住的「🔴 LIVE 实时作答中」。
   */
  const abandon = (note = '') => {
    streamDone = false
    pendingDone = null
    if (thoughtBuffer) {
      msg.thinkingText += thoughtBuffer
      thoughtBuffer = ''
    }
    if (tokenBuffer) {
      msg.content += tokenBuffer
      tokenBuffer = ''
    }
    stop()
    msg.thinking = false
    if (note && !msg.interruptedNote) msg.interruptedNote = note
    scrollToBottom()
  }

  /** 重开页面时把已完成部分瞬间填回，之后 live 事件按 seq 去重继续追加。 */
  const hydrate = (data = {}) => {
    if (data.runId) runId = data.runId
    if (typeof data.lastSeq === 'number') lastSeq = data.lastSeq
    if (Array.isArray(data.thoughts) && data.thoughts.length) msg.thoughts = data.thoughts.slice()
    if (data.thinkingText) msg.thinkingText = data.thinkingText
    if (data.content) msg.content = data.content
    if (data.agent) msg.agent = data.agent
    if (data.mode) msg.mode = data.mode
    if (Array.isArray(data.trace)) msg.trace = data.trace.slice()
  }

  const snapshot = () => ({
    runId,
    lastSeq,
    thinkingText: msg.thinkingText || '',
    content: msg.content || '',
    thoughts: (msg.thoughts || []).slice(),
    agent: msg.agent || '',
    mode: msg.mode || '',
    trace: (msg.trace || []).slice(),
  })

  return {
    handlers: {
      onEvent: track,
      onTask,
      onThought,
      onToken,
      onDone,
      onError,
      onSnapshot,
      onResumePlan,
    },
    seedOpening,
    hydrate,
    snapshot,
    stop,
    abandon,
    isBusy: () => timer !== null,
    isSettled: () => streamDone,
    get runId() {
      return runId
    },
    get lastSeq() {
      return lastSeq
    },
  }
}
