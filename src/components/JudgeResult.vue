<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  result: { type: Object, required: true },
})

const showTrace = ref(false)

const VERDICT_META = {
  correct: { label: '回答正确', color: 'var(--ok)', bg: '#e8f7ee' },
  partial: { label: '部分正确', color: 'var(--warn)', bg: '#fdf3e3' },
  incorrect: { label: '回答不正确', color: 'var(--bad)', bg: '#fdeaea' },
  invalid: { label: '输入无效', color: 'var(--ink-soft)', bg: '#eef0f5' },
}

const MODE_LABEL = {
  llm: '大模型判定',
  rule: '离线规则判定',
  'llm+rule': '大模型 + 规则复核',
}

const verdictMeta = computed(() => VERDICT_META[props.result.verdict] ?? VERDICT_META.invalid)
const modeLabel = computed(() => MODE_LABEL[props.result.mode] ?? props.result.mode)
const scoreText = computed(() => Math.round(props.result.score))
const feedbackLines = computed(() =>
  (props.result.feedback || '').split('\n').filter((line) => line.trim()),
)
const hasReference = computed(() => (props.result.reference?.definitions?.length ?? 0) > 0)
</script>

<template>
  <section class="card result-card">
    <header class="result-head">
      <span class="badge" :style="{ color: verdictMeta.color, background: verdictMeta.bg }">
        {{ verdictMeta.label }}
      </span>
      <span class="mode">{{ modeLabel }}</span>
    </header>

    <div class="score-block">
      <div class="score-row">
        <span class="score-label">得分</span>
        <span class="score-value" :style="{ color: verdictMeta.color }">{{ scoreText }}</span>
        <span class="score-unit">/ 100</span>
        <span class="confidence">模型置信度 {{ (result.confidence * 100).toFixed(0) }}%</span>
      </div>
      <div class="score-track">
        <div
          class="score-fill"
          :style="{ width: `${result.score}%`, background: verdictMeta.color }"
        ></div>
      </div>
    </div>

    <div class="feedback">
      <p v-for="(line, index) in feedbackLines" :key="index" :class="{ headline: index === 0 }">
        {{ line }}
      </p>
    </div>

    <div v-if="hasReference" class="reference">
      <h3>参考释义</h3>
      <div class="defs">
        <span v-for="d in result.reference.definitions" :key="d" class="def-chip">{{ d }}</span>
      </div>
      <p v-if="result.reference.example" class="ref-example">
        {{ result.reference.example }}
        <em>{{ result.reference.example_zh }}</em>
      </p>
    </div>

    <div class="trace-block">
      <button class="trace-toggle" type="button" @click="showTrace = !showTrace">
        {{ showTrace ? '收起' : '展开' }} LangGraph 判定流程（{{ result.trace.length }} 步）
      </button>
      <ol v-if="showTrace" class="trace">
        <li v-for="(step, index) in result.trace" :key="index">
          <code>{{ step }}</code>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.result-card {
  margin-top: 20px;
  animation: rise 0.28s ease-out;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.result-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.badge {
  font-size: 15px;
  font-weight: 700;
  padding: 6px 16px;
  border-radius: 999px;
}

.mode {
  font-size: 12px;
  color: var(--ink-soft);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 12px;
}

.score-block {
  margin: 22px 0;
}

.score-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 8px;
}

.score-label {
  font-size: 13px;
  color: var(--ink-soft);
}

.score-value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
}

.score-unit {
  font-size: 13px;
  color: var(--ink-soft);
}

.confidence {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-soft);
}

.score-track {
  height: 8px;
  background: #eef0f6;
  border-radius: 999px;
  overflow: hidden;
}

.score-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.feedback {
  padding: 16px 18px;
  background: #f8f9fd;
  border-radius: 12px;
}

.feedback p {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  color: #3c465c;
  white-space: pre-wrap;
}

.feedback p.headline {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}

.reference {
  margin-top: 20px;
}

.reference h3 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
}

.defs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.def-chip {
  font-size: 14px;
  color: var(--brand-dark);
  background: #eef1ff;
  border-radius: 8px;
  padding: 5px 12px;
}

.ref-example {
  margin: 12px 0 0;
  font-size: 14px;
  color: #3c465c;
  line-height: 1.7;
}

.ref-example em {
  display: block;
  font-style: normal;
  font-size: 13px;
  color: var(--ink-soft);
}

.trace-block {
  margin-top: 22px;
  border-top: 1px dashed var(--line);
  padding-top: 16px;
}

.trace-toggle {
  font-size: 13px;
  color: var(--brand);
  background: none;
  border: none;
  padding: 0;
}

.trace-toggle:hover {
  text-decoration: underline;
}

.trace {
  margin: 12px 0 0;
  padding-left: 20px;
  font-size: 12.5px;
  line-height: 1.9;
  color: var(--ink-soft);
}

.trace code {
  font-family: "Cascadia Code", Consolas, monospace;
  background: #f4f6fb;
  border-radius: 4px;
  padding: 1px 5px;
  word-break: break-all;
}
</style>
