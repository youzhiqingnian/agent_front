<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  fetchCsReplayEvents,
  fetchCsReplayModels,
  fetchCsReplayTurns,
  runCsGhostReplay,
  runCsReplayFork,
} from '../api'

const props = defineProps({
  item: { type: Object, required: true },
})
const emit = defineEmits(['close'])

// ===== 节点与事件的中文标题映射 =====
const NODE_LABELS = {
  security_check: '🛡️ 安全风控审查',
  mem0_memory_retrieve: '🗂️ 长期记忆检索',
  rewrite_node: '🔍 意图分析与上下文重写',
  semantic_cache_check: '⚡ 语义缓存检索',
  supervisor: '🧭 调度主管',
  multi_question_coordinator: '🧩 多问题协同器',
  text_to_sql_agent: '📊 数据查询专员',
  sql_summary_node: '📝 数据汇总节点',
  order_agent: '📦 订单专员',
  product_agent: '🛒 商品专员',
  aftersale_agent: '🔧 售后专员',
  chitchat_agent: '💬 闲聊专员',
  finalize: '🏁 轮次收尾',
}

const MODE_LABELS = {
  new: '🆕 新轮次',
  resume: '🔁 补充恢复轮',
}

function nodeLabel(node) {
  return NODE_LABELS[node] || `⚙️ ${node}`
}

function fmtMs(ms) {
  if (ms == null) return ''
  const s = (ms / 1000).toFixed(1)
  return `${s}s`
}

// ===== 状态 =====
const turns = ref([])
const selectedTurnId = ref('')
const events = ref([])
const loading = ref(false)
const loadError = ref('')
const playing = ref(false)
const speed = ref(1)
const playedMs = ref(0)
const sourceMode = ref('recorded') // recorded | replayed | forked
const expandedSeq = ref(new Set())
const timelineEl = ref(null)
const forkPanelEl = ref(null)

const ghost = ref(null)
const ghostLoading = ref(false)
const ghostError = ref('')

// ===== 条件重放（调试分叉）状态 =====
const models = ref([])
const forkBoundary = ref(null) // 记录 node_exit 序列的 0-based 起点；null=未选择
const forkConfig = reactive({
  model_override: '',
  temperature_override: '',
  prompt_override: '',
  user_message_override: '',
})
const forkBusy = ref(false)
const forkError = ref('')
const fork = ref(null)

let playTimer = null

const totalMs = computed(() => {
  const list = timelineEvents.value
  if (!list.length) return 0
  return Math.max(...list.map((e) => e.elapsed_ms ?? 0))
})

const replayDerivedEvents = computed(() => {
  const g = ghost.value
  if (!g || !g.replayed) return []
  const nodes = g.replayed.nodes || []
  const total = totalMs.value || 1
  const derived = nodes.map((n, i) => ({
    seq: -(i + 1),
    type: 'node_exit',
    node: n,
    elapsed_ms: Math.round((total * (i + 1)) / (nodes.length + 1)),
    synthetic: true,
  }))
  if (g.replayed.reply) {
    derived.push({
      seq: -(nodes.length + 1),
      type: 'turn_end',
      reply: g.replayed.reply,
      agent: g.replayed.agent,
      mode: g.replayed.mode,
      elapsed_ms: total,
      synthetic: true,
    })
  }
  return derived
})

const forkDerivedEvents = computed(() => {
  const f = fork.value
  if (!f || !f.forked) return []
  const nodes = f.forked.nodes || []
  const total = totalMs.value || 1
  const derived = nodes.map((n, i) => ({
    seq: -(i + 1),
    type: 'node_exit',
    node: n,
    elapsed_ms: Math.round((total * (i + 1)) / (nodes.length + 1)),
    synthetic: true,
  }))
  if (f.forked.reply) {
    derived.push({
      seq: -(nodes.length + 1),
      type: 'turn_end',
      reply: f.forked.reply,
      agent: f.forked.agent,
      mode: f.forked.mode,
      elapsed_ms: total,
      synthetic: true,
    })
  }
  return derived
})

const timelineEvents = computed(() => {
  if (sourceMode.value === 'replayed') return replayDerivedEvents.value
  if (sourceMode.value === 'forked') return forkDerivedEvents.value
  return events.value
})

// 记录时间线中的节点序列（带 0-based 序号，用于分叉起点选择）
const recordedNodeExits = computed(() =>
  (events.value || [])
    .filter((e) => e.type === 'node_exit' && !e.synthetic)
    .map((e, i) => ({ ...e, node_index: i })),
)

function nodeExitIndex(seq) {
  const idx = recordedNodeExits.value.findIndex((e) => e.seq === seq)
  return idx >= 0 ? idx : null
}

const boundaryOptions = computed(() => {
  const opts = recordedNodeExits.value.map((e) => ({
    value: e.node_index,
    label: nodeLabel(e.node),
  }))
  opts.push({ value: recordedNodeExits.value.length, label: '末尾 · 全缓存快进' })
  return opts
})

const boundaryNodeName = computed(() => {
  if (forkBoundary.value === null) return ''
  const exit = recordedNodeExits.value[forkBoundary.value]
  return exit ? exit.node : ''
})

const forkBoundaryLabel = computed(() => {
  if (forkBoundary.value === null) return '未选择'
  if (forkBoundary.value >= recordedNodeExits.value.length) return '末尾 · 全缓存快进'
  return nodeLabel(boundaryNodeName.value)
})

const revealedEvents = computed(() =>
  timelineEvents.value.filter((e) => (e.elapsed_ms ?? 0) <= playedMs.value),
)

const lastRevealedSeq = computed(() => {
  const list = revealedEvents.value
  return list.length ? list[list.length - 1].seq : null
})

const currentTurn = computed(() =>
  turns.value.find((t) => t.turn_id === selectedTurnId.value) || null,
)

// ===== 数据加载 =====
async function loadTurns() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await fetchCsReplayTurns(props.item.conversation_id)
    turns.value = data.turns || []
    if (turns.value.length) {
      selectedTurnId.value = turns.value[turns.value.length - 1].turn_id
      await loadEvents()
    } else {
      loadError.value = '该会话暂无回放记录（需先产生一轮问答）'
    }
  } catch (err) {
    loadError.value = err.message || '轮次列表加载失败'
  } finally {
    loading.value = false
  }
}

async function loadEvents() {
  if (!selectedTurnId.value) return
  loading.value = true
  loadError.value = ''
  ghost.value = null
  ghostError.value = ''
  fork.value = null
  forkError.value = ''
  forkBoundary.value = null
  forkConfig.model_override = ''
  forkConfig.temperature_override = ''
  forkConfig.prompt_override = ''
  forkConfig.user_message_override = ''
  sourceMode.value = 'recorded'
  expandedSeq.value = new Set()
  stopPlayback()
  playedMs.value = 0
  try {
    const data = await fetchCsReplayEvents(props.item.conversation_id, selectedTurnId.value)
    events.value = data.events || []
  } catch (err) {
    events.value = []
    loadError.value = err.message || '事件时间线加载失败'
  } finally {
    loading.value = false
  }
}

async function selectTurn(turnId) {
  if (turnId === selectedTurnId.value) return
  selectedTurnId.value = turnId
  await loadEvents()
}

// ===== 时间线播放 =====
function startPlayback() {
  if (!timelineEvents.value.length) return
  if (playedMs.value >= totalMs.value) playedMs.value = 0
  playing.value = true
  clearInterval(playTimer)
  playTimer = setInterval(() => {
    playedMs.value = Math.min(totalMs.value, playedMs.value + 100 * speed.value)
    if (playedMs.value >= totalMs.value) stopPlayback()
  }, 100)
}

function stopPlayback() {
  playing.value = false
  clearInterval(playTimer)
  playTimer = null
}

function togglePlayback() {
  if (playing.value) stopPlayback()
  else startPlayback()
}

function stepForward() {
  stopPlayback()
  const next = timelineEvents.value.find((e) => (e.elapsed_ms ?? 0) > playedMs.value)
  if (next) playedMs.value = next.elapsed_ms
  else playedMs.value = totalMs.value
}

function resetPlayback() {
  stopPlayback()
  playedMs.value = 0
}

function toggleExpand(seq) {
  const next = new Set(expandedSeq.value)
  if (next.has(seq)) next.delete(seq)
  else next.add(seq)
  expandedSeq.value = next
}

function isExpanded(seq) {
  return expandedSeq.value.has(seq)
}

function scrollToLastRevealed() {
  nextTick(() => {
    const el = timelineEl.value
    if (!el) return
    const cards = el.querySelectorAll('.rp-step.revealed')
    if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'nearest' })
  })
}

watch(revealedEvents, () => {
  if (playing.value) scrollToLastRevealed()
})

// ===== 幽灵重放 =====
async function runGhost() {
  ghostLoading.value = true
  ghostError.value = ''
  ghost.value = null
  try {
    ghost.value = await runCsGhostReplay(props.item.conversation_id, selectedTurnId.value)
  } catch (err) {
    ghostError.value = err.message || '幽灵重放执行失败'
  } finally {
    ghostLoading.value = false
  }
}

function useReplayedSource() {
  sourceMode.value = 'replayed'
  playedMs.value = 0
  stopPlayback()
}

// ===== 条件重放（调试分叉） =====
async function loadModels() {
  try {
    const res = await fetchCsReplayModels()
    models.value = res.items || []
  } catch (err) {
    console.error('获取回放模型清单失败:', err)
  }
}

function pickBoundary(index) {
  forkBoundary.value = index
  fork.value = null
  forkError.value = ''
  nextTick(() => {
    const el = forkPanelEl.value
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

async function runFork() {
  if (forkBoundary.value === null) {
    forkError.value = '请先选择分叉起点：点击节点卡上的「🔀 从这步重跑」或在下拉框中选择'
    return
  }
  forkBusy.value = true
  forkError.value = ''
  fork.value = null
  try {
    const payload = { start_node_index: forkBoundary.value }
    if (forkConfig.model_override) payload.model_override = forkConfig.model_override
    const temp = Number(forkConfig.temperature_override)
    if (forkConfig.temperature_override !== '' && Number.isFinite(temp) && temp > 0) {
      payload.temperature_override = temp
    }
    if (forkConfig.user_message_override.trim()) {
      payload.user_message_override = forkConfig.user_message_override.trim()
    }
    if (boundaryNodeName.value && forkConfig.prompt_override.trim()) {
      payload.system_prompt_overrides = { [boundaryNodeName.value]: forkConfig.prompt_override.trim() }
    }
    fork.value = await runCsReplayFork(props.item.conversation_id, selectedTurnId.value, payload)
  } catch (err) {
    forkError.value = err.message || '条件重放执行失败'
  } finally {
    forkBusy.value = false
  }
}

function useForkedSource() {
  sourceMode.value = 'forked'
  playedMs.value = 0
  stopPlayback()
}

// ===== 事件卡渲染辅助 =====
function eventTitle(e) {
  switch (e.type) {
    case 'turn_start':
      return `${MODE_LABELS[e.mode] || '🚀 轮次开始'} · 用户提问`
    case 'initial_state':
      return '📦 初始状态快照'
    case 'node_exit':
      return nodeLabel(e.node)
    case 'llm_start':
      return `🤖 LLM 调用 #${e.call_index} 发起`
    case 'llm_end':
      return `🤖 LLM 调用 #${e.call_index} 完成`
    case 'interrupt':
      return '⏸️ 澄清挂起 (HIL interrupt)'
    case 'turn_end':
      return '✅ 轮次结束'
    case 'turn_error':
      return '❌ 轮次异常'
    default:
      return e.type
  }
}

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function truncate(text, len = 240) {
  const s = String(text ?? '')
  return s.length > len ? `${s.slice(0, len)}…` : s
}

onMounted(() => {
  loadTurns()
  loadModels()
})
onBeforeUnmount(stopPlayback)
</script>

<template>
  <div class="replay-panel">
    <!-- 面板头 -->
    <div class="rp-header">
      <div class="rp-header-left">
        <span class="rp-badge">🎬 Agent 回放面板</span>
        <span class="rp-sub">会话 {{ item.conversation_id }} · 确定性可重放状态机</span>
      </div>
      <div class="rp-header-right">
        <button class="rp-btn ghost-btn" type="button" :disabled="!selectedTurnId || ghostLoading" @click="runGhost">
          {{ ghostLoading ? '👻 重放中…' : '👻 幽灵重放（零 token 确定性校验）' }}
        </button>
        <button class="rp-btn back-btn" type="button" @click="emit('close')">← 返回</button>
      </div>
    </div>

    <!-- 轮次选择条 -->
    <div v-if="turns.length" class="rp-turns">
      <button
        v-for="t in turns"
        :key="t.turn_id"
        class="rp-turn-chip"
        :class="{ active: t.turn_id === selectedTurnId }"
        type="button"
        :title="`${t.started_at} · ${t.user_message}`"
        @click="selectTurn(t.turn_id)"
      >
        <span class="chip-time">{{ (t.started_at || '').slice(11, 19) }}</span>
        <span class="chip-msg">{{ truncate(t.user_message, 18) }}</span>
        <span v-if="t.interrupted" class="chip-tag warn">⏸ 挂起</span>
        <span v-else-if="t.resume_of_turn_id" class="chip-tag">🔁 补充</span>
      </button>
    </div>

    <!-- 幽灵重放结果 -->
    <div v-if="ghost" class="rp-ghost-result" :class="{ consistent: ghost.consistent }">
      <div class="ghost-summary">
        <span class="ghost-badge" :class="ghost.consistent ? 'ok' : 'bad'">
          {{ ghost.consistent ? '✓ 确定性一致' : '✗ 确定性发散' }}
        </span>
        <span class="ghost-stat">缓存命中 <b>{{ ghost.hits }}</b> / 共 {{ ghost.llm_calls }} 次 LLM 调用</span>
        <span class="ghost-stat">未命中 <b :class="{ miss: ghost.misses > 0 }">{{ ghost.misses }}</b></span>
        <button
          v-if="ghost.consistent"
          class="rp-btn replace-btn"
          type="button"
          @click="useReplayedSource"
        >
          🎞 用重放时间线替换动画数据源
        </button>
      </div>
      <div v-if="ghost.diffs && ghost.diffs.length" class="ghost-diffs">
        <div v-for="(d, i) in ghost.diffs" :key="i" class="ghost-diff">✗ {{ d }}</div>
      </div>
      <div v-if="ghost.consistent" class="ghost-compare">
        <div class="compare-col">
          <div class="compare-title">记录 (recorded)</div>
          <pre class="compare-pre">{{ prettyJson(ghost.recorded) }}</pre>
        </div>
        <div class="compare-col">
          <div class="compare-title">重放 (replayed)</div>
          <pre class="compare-pre">{{ prettyJson(ghost.replayed) }}</pre>
        </div>
      </div>
    </div>

    <!-- 条件重放（调试分叉）配置面板 -->
    <div ref="forkPanelEl" class="rp-fork-config">
      <div class="fork-config-title">
        🔀 条件重放 · 调试分叉
        <span class="fork-boundary-tag">起点: {{ forkBoundaryLabel }}</span>
      </div>
      <div class="fork-config-grid">
        <label class="fork-field">
          <span class="fork-field-label">分叉起点（节点序列第几步起真实推理）</span>
          <select v-model.number="forkBoundary" class="fork-input">
            <option :value="null" disabled>请选择起点…</option>
            <option v-for="opt in boundaryOptions" :key="opt.value" :value="opt.value">
              第 {{ opt.value }} 步 · {{ opt.label }}
            </option>
          </select>
        </label>
        <label class="fork-field">
          <span class="fork-field-label">覆盖大模型</span>
          <select v-model="forkConfig.model_override" class="fork-input">
            <option value="">不覆盖（默认降级链）</option>
            <option v-for="m in models" :key="m.name" :value="m.name">
              {{ m.name }}{{ m.is_primary ? ' · 主力' : '' }}{{ m.has_key ? '' : ' · 未配密钥' }}
            </option>
          </select>
        </label>
        <label class="fork-field">
          <span class="fork-field-label">覆盖 temperature（留空不覆盖，0-2）</span>
          <input
            v-model="forkConfig.temperature_override"
            class="fork-input"
            type="number"
            min="0.01"
            max="2"
            step="0.1"
            placeholder="留空不覆盖"
          >
        </label>
        <label class="fork-field fork-field-wide">
          <span class="fork-field-label">
            边界节点 system 提示词覆盖（作用于「{{ forkBoundaryLabel }}」；末尾全缓存时无效）
          </span>
          <textarea
            v-model="forkConfig.prompt_override"
            class="fork-input fork-textarea"
            rows="2"
            :disabled="boundaryNodeName === ''"
            placeholder="例如：你是调度主管，请把问题分派给售后专员，并只用一句话回复。"
          ></textarea>
        </label>
        <label class="fork-field fork-field-wide">
          <span class="fork-field-label">替换用户提问（填写后强制从头全 live 重跑）</span>
          <input
            v-model="forkConfig.user_message_override"
            class="fork-input"
            type="text"
            placeholder="留空使用原始提问"
          >
        </label>
      </div>
      <div class="fork-config-actions">
        <button class="rp-btn fork-run-btn" type="button" :disabled="forkBusy || !selectedTurnId" @click="runFork">
          {{ forkBusy ? '🔀 分叉推理中…（边界后真实调用 LLM）' : '🔀 运行条件重放' }}
        </button>
        <span class="fork-hint">边界前零 token 缓存快进 · 边界后真实调用 LLM / Redis / MySQL / mem0</span>
      </div>
      <p v-if="forkError" class="rp-error fork-error">{{ forkError }}</p>
    </div>

    <!-- 条件重放结果：记录 vs 分叉 -->
    <div v-if="fork" class="rp-fork-result">
      <div class="fork-summary">
        <span class="fork-badge" :class="fork.error ? 'bad' : fork.diffs.length ? 'diverged' : 'ok'">
          {{ fork.error ? '✗ 分叉执行异常' : fork.diffs.length ? '🔀 分叉完成（与记录存在差异）' : '🔀 分叉完成（与记录一致）' }}
        </span>
        <span class="ghost-stat">
          边界: <b>{{ fork.boundary_node }}</b>（第 {{ fork.start_node_index }} 步）
        </span>
        <span class="ghost-stat">真实模型: <b>{{ fork.live_model }}</b></span>
        <span class="ghost-stat">
          LLM 调用 <b>{{ fork.llm_calls }}</b> 次
          · 缓存快进 <b>{{ fork.cached_calls }}</b>
          · 真实推理 <b :class="{ miss: fork.live_calls > 0 }">{{ fork.live_calls }}</b>
        </span>
        <button
          v-if="!fork.error && fork.forked && fork.forked.nodes && fork.forked.nodes.length"
          class="rp-btn replace-btn"
          type="button"
          @click="useForkedSource"
        >
          🎞 用分叉时间线替换动画数据源
        </button>
      </div>
      <p v-if="fork.error" class="rp-line error-text fork-result-error">{{ fork.error }}</p>
      <div v-if="fork.diffs && fork.diffs.length" class="fork-diffs">
        <div class="fork-diffs-note">⚠️ 分叉差异属预期：这正是更换条件后的调试产物</div>
        <div v-for="(d, i) in fork.diffs" :key="i" class="ghost-diff">✗ {{ d }}</div>
      </div>
      <div v-if="fork.recorded && fork.forked" class="ghost-compare">
        <div class="compare-col">
          <div class="compare-title">记录 (recorded)</div>
          <pre class="compare-pre">{{ prettyJson(fork.recorded) }}</pre>
        </div>
        <div class="compare-col">
          <div class="compare-title">分叉 (forked)</div>
          <pre class="compare-pre">{{ prettyJson(fork.forked) }}</pre>
        </div>
      </div>
    </div>

    <!-- 播放控制条 -->
    <div v-if="timelineEvents.length" class="rp-toolbar">
      <button class="rp-btn play-btn" type="button" @click="togglePlayback">
        {{ playing ? '⏸ 暂停' : '▶ 播放' }}
      </button>
      <button class="rp-btn" type="button" @click="stepForward">⏭ 单步</button>
      <button class="rp-btn" type="button" @click="resetPlayback">↺ 重置</button>
      <select v-model.number="speed" class="rp-speed">
        <option :value="0.5">0.5x</option>
        <option :value="1">1x</option>
        <option :value="2">2x</option>
        <option :value="4">4x</option>
      </select>
      <input
        v-model.number="playedMs"
        class="rp-progress"
        type="range"
        min="0"
        :max="totalMs"
        step="50"
        @input="stopPlayback"
      >
      <span class="rp-time">{{ fmtMs(playedMs) }} / {{ fmtMs(totalMs) }}</span>
      <span v-if="sourceMode === 'replayed'" class="rp-source-tag">🎞 重放数据源</span>
      <span v-if="sourceMode === 'forked'" class="rp-source-tag fork">🔀 分叉数据源</span>
    </div>

    <!-- 执行时间线 -->
    <div ref="timelineEl" class="rp-timeline">
      <div v-if="loading" class="rp-loading">⏳ 加载回放数据…</div>
      <div v-else-if="loadError" class="rp-error">{{ loadError }}</div>

      <template v-else v-for="e in revealedEvents" :key="e.seq">
        <!-- LLM 事件卡 -->
        <div
          v-if="e.type === 'llm_start' || e.type === 'llm_end'"
          class="rp-step llm-card revealed"
          :class="{ current: e.seq === lastRevealedSeq && playing, end: e.type === 'llm_end' }"
        >
          <div class="rp-step-head" @click="toggleExpand(e.seq)">
            <span class="rp-step-title">{{ eventTitle(e) }}</span>
            <span class="rp-step-meta">
              {{ nodeLabel(e.node) }} · {{ e.call_kind }} · {{ e.task_type }} · {{ fmtMs(e.elapsed_ms) }}
            </span>
            <span class="rp-expand">{{ isExpanded(e.seq) ? '▾' : '▸' }}</span>
          </div>
          <div v-if="isExpanded(e.seq)" class="rp-step-body">
            <div v-if="e.type === 'llm_start'" class="rp-kv">
              <div class="rp-kv-label">输入 (input_hash: {{ e.input_hash }})</div>
              <pre class="rp-pre">{{ truncate(prettyJson(e.input), 900) }}</pre>
            </div>
            <div v-else class="rp-kv">
              <div class="rp-kv-label">
                输出 ({{ e.model_name || '未知模型' }})
                <span v-if="e.error" class="rp-kv-error">· 调用异常</span>
              </div>
              <pre class="rp-pre">{{ truncate(e.output || e.error || '', 900) }}</pre>
            </div>
          </div>
        </div>

        <!-- 通用事件卡（节点/初始状态/中断/收尾） -->
        <div
          v-else
          class="rp-step revealed"
          :class="[
            { current: e.seq === lastRevealedSeq && playing },
            `kind-${e.type}`,
            { synthetic: e.synthetic },
          ]"
        >
          <div class="rp-step-head" @click="toggleExpand(e.seq)">
            <span class="rp-step-title">{{ eventTitle(e) }}</span>
            <span class="rp-step-meta">
              <template v-if="e.type === 'node_exit'">节点完成 · {{ fmtMs(e.elapsed_ms) }}</template>
              <template v-else-if="e.type === 'interrupt'">等待用户补充 · {{ fmtMs(e.elapsed_ms) }}</template>
              <template v-else-if="e.type === 'turn_end'">
                {{ e.agent }} · {{ e.mode }} · {{ fmtMs(e.elapsed_ms) }}
              </template>
              <template v-else>{{ fmtMs(e.elapsed_ms) }}</template>
            </span>
            <button
              v-if="e.type === 'node_exit' && !e.synthetic && nodeExitIndex(e.seq) !== null"
              class="rp-btn fork-step-btn"
              type="button"
              :title="`从节点序列第 ${nodeExitIndex(e.seq)} 步起，按新条件重新推理`"
              @click.stop="pickBoundary(nodeExitIndex(e.seq))"
            >
              🔀 从这步重跑
            </button>
            <span class="rp-expand">{{ isExpanded(e.seq) ? '▾' : '▸' }}</span>
          </div>

          <!-- 事件正文 -->
          <div class="rp-step-summary">
            <template v-if="e.type === 'turn_start'">
              <p class="rp-line">💬 {{ e.user_message }}</p>
              <p v-if="e.resume_of_turn_id" class="rp-line subtle">溯源挂起轮: {{ e.resume_of_turn_id }}</p>
            </template>
            <template v-else-if="e.type === 'interrupt'">
              <p class="rp-line">「{{ e.prompt }}」</p>
            </template>
            <template v-else-if="e.type === 'turn_end'">
              <p class="rp-line">{{ truncate(e.reply, 300) }}</p>
            </template>
            <template v-else-if="e.type === 'turn_error'">
              <p class="rp-line error-text">{{ e.error }}</p>
            </template>
            <template v-else-if="e.type === 'node_exit' && e.synthetic">
              <p class="rp-line subtle">
                {{ sourceMode === 'forked' ? '条件重放节点序列（分叉派生事件）' : '幽灵重放节点序列（派生事件）' }}
              </p>
            </template>
          </div>

          <div v-if="isExpanded(e.seq)" class="rp-step-body">
            <div v-if="e.type === 'node_exit' && e.updates" class="rp-kv">
              <div class="rp-kv-label">节点写回增量 (updates)</div>
              <pre class="rp-pre">{{ truncate(prettyJson(e.updates), 900) }}</pre>
            </div>
            <div v-if="e.type === 'node_exit' && e.state_snapshot" class="rp-kv">
              <div class="rp-kv-label">节点完成后状态快照 (state_snapshot)</div>
              <pre class="rp-pre">{{ truncate(prettyJson(e.state_snapshot), 1400) }}</pre>
            </div>
            <div v-if="e.type === 'initial_state'" class="rp-kv">
              <div class="rp-kv-label">重建轮次的初始状态（含历史 messages 与压缩记忆快照）</div>
              <pre class="rp-pre">{{ truncate(prettyJson(e.state), 1400) }}</pre>
            </div>
          </div>
        </div>
      </template>

      <div v-if="!loading && !loadError && !revealedEvents.length" class="rp-empty">
        按「▶ 播放」或拖动进度条查看执行时间线
      </div>
    </div>
  </div>
</template>

<style scoped>
.replay-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.rp-header {
  padding: 10px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.rp-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rp-badge {
  font-size: 12.5px;
  font-weight: 700;
  color: #7c3aed;
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
  padding: 2px 8px;
  border-radius: 6px;
}

.rp-sub {
  font-size: 12px;
  color: #64748b;
}

.rp-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rp-btn {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #475569;
}

.rp-btn:hover {
  background: #e2e8f0;
  color: #1e293b;
}

.rp-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ghost-btn {
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
  color: #6d28d9;
  font-weight: 600;
}

.ghost-btn:hover {
  background: #ede9fe;
}

.back-btn {
  font-weight: 600;
}

/* 轮次选择条 */
.rp-turns {
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid #e2e8f0;
  overflow-x: auto;
  background: #fff;
}

.rp-turn-chip {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s;
}

.rp-turn-chip:hover {
  border-color: #c4b5fd;
}

.rp-turn-chip.active {
  background: #f5f3ff;
  border-color: #8b5cf6;
  color: #5b21b6;
  font-weight: 600;
}

.chip-time {
  color: #94a3b8;
}

.chip-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #ecfdf5;
  color: #047857;
}

.chip-tag.warn {
  background: #fef3c7;
  color: #b45309;
}

/* 幽灵重放结果 */
.rp-ghost-result {
  margin: 10px 16px 0;
  border: 1px solid #fecaca;
  background: #fef2f2;
  border-radius: 10px;
  padding: 10px 12px;
}

.rp-ghost-result.consistent {
  border-color: #a7f3d0;
  background: #ecfdf5;
}

.ghost-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.ghost-badge {
  font-size: 13px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 6px;
}

.ghost-badge.ok {
  background: #10b981;
  color: #fff;
}

.ghost-badge.bad {
  background: #ef4444;
  color: #fff;
}

.ghost-stat {
  font-size: 12px;
  color: #334155;
}

.ghost-stat b {
  color: #047857;
}

.ghost-stat b.miss {
  color: #dc2626;
}

.replace-btn {
  margin-left: auto;
  background: #fff;
  border-color: #a7f3d0;
  color: #047857;
}

.ghost-diffs {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ghost-diff {
  font-size: 12px;
  color: #b91c1c;
}

.ghost-compare {
  margin-top: 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.compare-col {
  min-width: 0;
}

.compare-title {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  margin-bottom: 4px;
}

.compare-pre {
  font-size: 11px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 8px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 播放控制条 */
.rp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}

.play-btn {
  background: #7c3aed;
  border-color: #7c3aed;
  color: #fff;
  font-weight: 600;
}

.play-btn:hover {
  background: #6d28d9;
  color: #fff;
}

.rp-speed {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
}

.rp-progress {
  flex: 1;
  min-width: 80px;
  accent-color: #7c3aed;
}

.rp-time {
  font-size: 12px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.rp-source-tag {
  font-size: 11px;
  color: #7c3aed;
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
  padding: 1px 6px;
  border-radius: 4px;
}

.rp-source-tag.fork {
  color: #b45309;
  background: #fffbeb;
  border-color: #fde68a;
}

/* ===== 条件重放（调试分叉）配置面板 ===== */
.rp-fork-config {
  margin: 10px 16px 0;
  border: 1px solid #fde68a;
  background: #fffbeb;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fork-config-title {
  font-size: 13px;
  font-weight: 700;
  color: #92400e;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fork-boundary-tag {
  font-size: 11px;
  font-weight: 600;
  color: #b45309;
  background: #fef3c7;
  border: 1px solid #fde68a;
  padding: 1px 8px;
  border-radius: 999px;
}

.fork-config-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.fork-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.fork-field-wide {
  grid-column: 1 / -1;
}

.fork-field-label {
  font-size: 11px;
  font-weight: 600;
  color: #92400e;
}

.fork-input {
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid #fde68a;
  border-radius: 6px;
  background: #fff;
  color: #1e293b;
  outline: none;
  transition: border-color 0.15s;
}

.fork-input:focus {
  border-color: #f59e0b;
}

.fork-input:disabled {
  background: #fef3c7;
  color: #a8a29e;
  cursor: not-allowed;
}

.fork-textarea {
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
}

.fork-config-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.fork-run-btn {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #fff;
  font-weight: 700;
}

.fork-run-btn:hover {
  background: #d97706;
  color: #fff;
}

.fork-hint {
  font-size: 11px;
  color: #a16207;
}

.fork-error {
  padding: 4px 0;
  font-size: 12px;
}

/* ===== 条件重放结果 ===== */
.rp-fork-result {
  margin: 10px 16px 0;
  border: 1px solid #fde68a;
  background: #fffbeb;
  border-radius: 10px;
  padding: 10px 12px;
}

.fork-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.fork-badge {
  font-size: 13px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 6px;
  color: #fff;
}

.fork-badge.ok {
  background: #10b981;
}

.fork-badge.diverged {
  background: #f59e0b;
}

.fork-badge.bad {
  background: #ef4444;
}

.fork-diffs {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fork-diffs-note {
  font-size: 11.5px;
  font-weight: 600;
  color: #b45309;
}

.fork-result-error {
  margin-top: 8px;
}

/* 节点卡上的「从这步重跑」按钮 */
.fork-step-btn {
  background: #fffbeb;
  border-color: #fde68a;
  color: #b45309;
  font-weight: 700;
  flex-shrink: 0;
}

.fork-step-btn:hover {
  background: #fef3c7;
  color: #92400e;
}

/* 时间线 */
.rp-timeline {
  flex: 1;
  overflow-y: auto;
  padding: 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rp-loading,
.rp-error,
.rp-empty {
  font-size: 13px;
  color: #64748b;
  text-align: center;
  padding: 30px 0;
}

.rp-error {
  color: #dc2626;
}

.rp-step {
  border: 1px solid #e2e8f0;
  border-left: 3px solid #94a3b8;
  border-radius: 10px;
  background: #fff;
  padding: 8px 12px;
  animation: rp-fade-in 0.25s ease;
}

@keyframes rp-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.rp-step.kind-turn_start {
  border-left-color: #3b82f6;
}

.rp-step.kind-node_exit {
  border-left-color: #8b5cf6;
}

.rp-step.kind-interrupt {
  border-left-color: #f59e0b;
  background: #fffbeb;
}

.rp-step.kind-turn_end {
  border-left-color: #10b981;
  background: #f0fdf4;
}

.rp-step.kind-turn_error {
  border-left-color: #ef4444;
  background: #fef2f2;
}

.rp-step.kind-initial_state {
  border-left-color: #06b6d4;
}

.rp-step.synthetic {
  border-left-style: dashed;
  background: #faf5ff;
}

.rp-step.current {
  box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.35);
}

.rp-step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex-wrap: wrap;
}

.rp-step-title {
  font-size: 13px;
  font-weight: 700;
  color: #1e293b;
}

.rp-step-meta {
  font-size: 11px;
  color: #94a3b8;
}

.rp-expand {
  margin-left: auto;
  font-size: 11px;
  color: #94a3b8;
}

.rp-step-summary {
  margin-top: 4px;
}

.rp-line {
  font-size: 12.5px;
  color: #334155;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.rp-line.subtle {
  color: #94a3b8;
  font-size: 11.5px;
}

.rp-line.error-text {
  color: #dc2626;
}

.rp-step-body {
  margin-top: 8px;
  border-top: 1px dashed #e2e8f0;
  padding-top: 8px;
}

.rp-kv {
  margin-bottom: 8px;
}

.rp-kv:last-child {
  margin-bottom: 0;
}

.rp-kv-label {
  font-size: 11.5px;
  font-weight: 700;
  color: #64748b;
  margin-bottom: 4px;
}

.rp-kv-error {
  color: #dc2626;
  font-weight: 600;
}

.rp-pre {
  font-size: 11px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 8px;
  margin: 0;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  color: #334155;
}
</style>
