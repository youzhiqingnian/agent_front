<script setup>
import { computed } from 'vue'

const props = defineProps({
  task: { type: Object, required: true },
})
const emit = defineEmits(['continue', 'restart', 'abandon'])

const stages = computed(() => props.task.stages || [])
const doneCount = computed(() => stages.value.filter((s) => s.status === 'done').length)

// 状态点只表达「这个环节当时走到哪」，不代表任务整体结论
function stageMark(stage, index) {
  if (stage.status === 'error') return { icon: '✕', cls: 'bad' }
  if (stage.status === 'running') return index === stages.value.length - 1 ? { icon: '▸', cls: 'now' } : { icon: '✕', cls: 'bad' }
  return { icon: '✓', cls: 'ok' }
}

const interruptText = computed(
  () => props.task.interrupt_text || props.task.interrupt_reason || '任务在执行中途被打断'
)
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop resume-backdrop">
      <div class="modal-card resume-card">
        <header class="resume-head">
          <span class="resume-badge">⏸ 上次问答未执行完</span>
          <h3 class="resume-question">「{{ task.question }}」</h3>
          <p class="resume-cause">
            停在 <b>{{ task.phase_title || '任务启动' }}</b> 阶段 · {{ interruptText }}
            <span v-if="task.started_at" class="resume-time">（发起于 {{ task.started_at }}）</span>
          </p>
        </header>

        <section class="resume-section">
          <div class="section-title">
            执行进度
            <span class="section-count">{{ doneCount }} / {{ stages.length }} 个环节已完成</span>
          </div>
          <ol class="stage-timeline">
            <li v-for="(stage, index) in stages" :key="`${stage.node}-${index}`" class="stage-item">
              <span class="stage-dot" :class="stageMark(stage, index).cls">
                {{ stageMark(stage, index).icon }}
              </span>
              <span class="stage-index">{{ index + 1 }}</span>
              <div class="stage-main">
                <div class="stage-title">{{ stage.title || stage.node }}</div>
                <div v-if="stage.detail" class="stage-detail">{{ stage.detail }}</div>
              </div>
              <span v-if="stage.ts" class="stage-ts">{{ stage.ts }}</span>
            </li>
          </ol>
        </section>

        <section v-if="task.partial_answer" class="resume-section">
          <details class="partial-box">
            <summary>已产出的半截回答（{{ task.partial_answer.length }} 字）</summary>
            <p class="partial-text">{{ task.partial_answer }}</p>
          </details>
        </section>

        <p class="resume-hint">
          <template v-if="task.resumable">
            继续执行将从「{{ task.phase_title || '中断处' }}」重新跑一次，前面 {{ doneCount }} 个已完成环节不会重复执行；
            该环节的大模型调用会重来，措辞可能与上次略有差异。第 {{ task.attempt }}/{{ task.max_attempts }} 次尝试。
          </template>
          <template v-else>
            这个现场没法接着跑：{{ task.unresumable_reason || '缺少可恢复的执行检查点' }}。可以重新开始提这个问题。
          </template>
        </p>

        <footer class="resume-foot">
          <!-- 不可续跑时主按钮降级到「重新开始」，别把用户引到一个置灰的按钮上 -->
          <button
            class="btn"
            :class="task.resumable ? 'btn-primary' : 'btn-ghost'"
            :disabled="!task.resumable"
            @click="emit('continue')"
          >
            从中断处继续
          </button>
          <button
            class="btn"
            :class="task.resumable ? 'btn-ghost' : 'btn-primary'"
            @click="emit('restart')"
          >
            重新开始
          </button>
          <button class="btn btn-quiet" @click="emit('abandon')">放弃这次任务</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.resume-backdrop {
  /* 必须三选一：不给点空白处和 ESC 关掉的口子，否则任务行会一直挂着 */
  z-index: 1100;
}

.resume-card {
  max-width: 620px;
  padding: 22px 24px 18px;
}

.resume-head {
  padding-right: 34px;
}

.resume-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  background: #fff7ed;
  color: var(--warn);
  font-size: 12px;
  font-weight: 600;
}

.resume-question {
  margin: 10px 0 6px;
  font-size: 16px;
  color: var(--ink);
  word-break: break-all;
}

.resume-cause {
  margin: 0;
  font-size: 13px;
  color: var(--ink-soft);
  line-height: 1.6;
}

.resume-time {
  color: var(--ink-soft);
  font-size: 12px;
}

.resume-section {
  margin-top: 16px;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 8px;
}

.section-count {
  font-weight: 400;
  font-size: 12px;
  color: var(--ink-soft);
}

.stage-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}

.stage-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}

.stage-item:last-child {
  border-bottom: none;
}

.stage-dot {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #fff;
  background: #cbd5e1;
}

.stage-dot.ok {
  background: var(--ok);
}

.stage-dot.now {
  background: var(--brand);
}

.stage-dot.bad {
  background: var(--bad);
}

.stage-index {
  flex: none;
  width: 16px;
  color: var(--ink-soft);
  font-size: 12px;
  text-align: right;
}

.stage-main {
  flex: 1;
  min-width: 0;
}

.stage-title {
  color: var(--ink);
}

.stage-detail {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.5;
  word-break: break-all;
}

.stage-ts {
  flex: none;
  font-size: 11px;
  color: var(--ink-soft);
}

.partial-box {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ink);
}

.partial-box summary {
  cursor: pointer;
  color: var(--ink-soft);
}

.partial-text {
  white-space: pre-wrap;
  margin: 8px 0 0;
  line-height: 1.6;
  color: var(--ink-soft);
}

.resume-hint {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8fafc;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-soft);
}

.resume-foot {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.btn {
  flex: 1;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-primary {
  background: var(--brand);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--brand-dark);
}

.btn-primary:disabled {
  background: #e2e8f0;
  color: #94a3b8;
  cursor: not-allowed;
}

.btn-ghost {
  background: #fff;
  border-color: var(--line);
  color: var(--ink);
}

.btn-ghost:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.btn-quiet {
  background: #fff;
  border-color: var(--line);
  color: var(--ink-soft);
}

.btn-quiet:hover {
  border-color: var(--bad);
  color: var(--bad);
}
</style>
