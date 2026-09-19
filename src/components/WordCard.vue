<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  card: { type: Object, required: true },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['submit'])
const answer = ref('')

watch(
  () => props.card.word,
  () => {
    answer.value = ''
  },
)

function onSubmit() {
  if (props.loading) return
  emit('submit', answer.value)
}
</script>

<template>
  <section class="card word-card">
    <header class="head">
      <span class="tag">英译中</span>
      <span class="hint">写出下面这个单词的中文释义</span>
    </header>

    <h1 class="word">{{ card.word }}</h1>

    <div class="meta">
      <span class="phonetic">{{ card.phonetic }}</span>
      <span v-for="p in card.pos" :key="p" class="pos">{{ p }}</span>
    </div>

    <p class="example">
      <span class="example-label">例句</span>
      {{ card.example }}
    </p>

    <form class="answer-form" @submit.prevent="onSubmit">
      <label class="answer-label" for="answer">你的答案</label>
      <div class="answer-row">
        <input
          id="answer"
          v-model="answer"
          class="answer-input"
          type="text"
          autocomplete="off"
          placeholder="请输入中文释义，例如：重要的"
          :disabled="loading"
        />
        <button class="submit-btn" type="submit" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          {{ loading ? '判定中…' : '确定' }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tag {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--brand);
  background: #eef1ff;
  border-radius: 999px;
  padding: 4px 12px;
}

.hint {
  font-size: 13px;
  color: var(--ink-soft);
}

.word {
  margin: 18px 0 6px;
  font-size: 52px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}

.phonetic {
  color: var(--ink-soft);
  font-size: 16px;
}

.pos {
  font-size: 12px;
  color: var(--ink-soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 2px 8px;
}

.example {
  margin: 0 0 26px;
  padding: 14px 16px;
  font-size: 15px;
  line-height: 1.6;
  color: #3c465c;
  background: #f8f9fd;
  border-left: 3px solid var(--brand);
  border-radius: 0 10px 10px 0;
}

.example-label {
  display: inline-block;
  margin-right: 8px;
  font-size: 12px;
  color: var(--ink-soft);
}

.answer-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.answer-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
}

.answer-row {
  display: flex;
  gap: 12px;
}

.answer-input {
  flex: 1;
  min-width: 0;
  padding: 13px 16px;
  font-size: 16px;
  color: var(--ink);
  border: 1.5px solid var(--line);
  border-radius: 12px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.answer-input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 4px rgba(79, 109, 245, 0.12);
}

.answer-input:disabled {
  background: #f7f8fb;
}

.submit-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 28px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  background: var(--brand);
  border: none;
  border-radius: 12px;
  transition: background 0.15s, transform 0.05s;
  white-space: nowrap;
}

.submit-btn:hover:not(:disabled) {
  background: var(--brand-dark);
}

.submit-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.submit-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 560px) {
  .card {
    padding: 20px;
  }
  .word {
    font-size: 40px;
  }
  .answer-row {
    flex-direction: column;
  }
  .submit-btn {
    justify-content: center;
  }
}
</style>
