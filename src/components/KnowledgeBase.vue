<script setup>
import { onMounted, ref, reactive, computed } from 'vue'
import {
  fetchKbStatus,
  fetchKbDocuments,
  fetchKbChunks,
  deleteKbDocument,
  searchKnowledgeBase,
  uploadKbDocument,
} from '../api'

// 视图切换: 'documents' (文档管理) | 'playground' (检索实验台)
const activeTab = ref('playground')

// 状态信息
const status = ref(null)
const statusLoading = ref(false)
const documents = ref([])
const docsLoading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

// 上传表单配置
const uploadFile = ref(null)
const uploadFileName = ref('')
const uploadLoading = ref(false)
const uploadProgressText = ref('')
const uploadForm = reactive({
  strategy: 'recursive', // 'recursive' | 'semantic' | 'hierarchical'
  chunk_size: 400,
  chunk_overlap: 60,
  breakpoint_percentile_threshold: 95,
  parent_chunk_size: 1200,
  child_chunk_size: 300,
})

// 切片查看抽屉/弹窗
const inspectingDoc = ref(null)
const chunksList = ref([])
const chunksLoading = ref(false)
const expandedParents = reactive({})

// 检索实验台配置
const searchForm = reactive({
  query: '',
  mode: 'hybrid', // 'hybrid' | 'dense' | 'bm25'
  top_k: 5,
  coarse_top_k: 20,
  enable_rewrite: false,
  enable_hyde: false,
  enable_multi_query: false,
  enable_rerank: true,
  enable_lost_in_middle: true,
  generate_answer: true,
})
const searchLoading = ref(false)
const searchResult = ref(null)
const searchError = ref('')

// 快捷测试问题
const sampleQueries = [
  'RAG 系统的核心优化思路与切块策略是什么？',
  '什么是混合检索？为什么推荐使用 RRF 算法？',
  '两阶段重排序与解决中间丢失是如何提升召回精度的？',
]

// 初始化
onMounted(async () => {
  await refreshStatus()
  await loadDocuments()
})

async function refreshStatus() {
  statusLoading.value = true
  try {
    status.value = await fetchKbStatus()
  } catch (err) {
    console.warn('获取知识库状态失败:', err)
  } finally {
    statusLoading.value = false
  }
}

async function loadDocuments() {
  docsLoading.value = true
  errorMessage.value = ''
  try {
    documents.value = await fetchKbDocuments()
  } catch (err) {
    errorMessage.value = err.message
  } finally {
    docsLoading.value = false
  }
}

// 处理文件选择
function handleFileChange(e) {
  const file = e.target.files?.[0]
  if (file) {
    uploadFile.value = file
    uploadFileName.value = file.name
  }
}

function handleDrop(e) {
  e.preventDefault()
  const file = e.dataTransfer.files?.[0]
  if (file) {
    uploadFile.value = file
    uploadFileName.value = file.name
  }
}

// 提交上传
async function handleUpload() {
  if (!uploadFile.value) {
    alert('请先选择要上传的文件')
    return
  }
  uploadLoading.value = true
  errorMessage.value = ''
  successMessage.value = ''
  uploadProgressText.value = '1/4 正在解析清洗文件内容与结构化表格…'

  try {
    const formData = new FormData()
    formData.append('file', uploadFile.value)
    formData.append('strategy', uploadForm.strategy)
    formData.append('chunk_size', uploadForm.chunk_size)
    formData.append('chunk_overlap', uploadForm.chunk_overlap)
    formData.append('breakpoint_percentile_threshold', uploadForm.breakpoint_percentile_threshold)
    formData.append('parent_chunk_size', uploadForm.parent_chunk_size)
    formData.append('child_chunk_size', uploadForm.child_chunk_size)

    setTimeout(() => {
      if (uploadLoading.value) {
        uploadProgressText.value = '2/4 正在执行文本切块与元数据注入…'
      }
    }, 1200)

    setTimeout(() => {
      if (uploadLoading.value) {
        uploadProgressText.value = '3/4 正在调用 BGE-M3 (1024维) 批量向量化…'
      }
    }, 2800)

    setTimeout(() => {
      if (uploadLoading.value) {
        uploadProgressText.value = '4/4 正在写入 Milvus 向量库并更新 BM25 倒排索引…'
      }
    }, 4500)

    const res = await uploadKbDocument(formData)
    successMessage.value = `文件 [${res.file_name}] 上传处理成功！已生成 ${res.chunk_count} 个切片并写入 Milvus。`
    uploadFile.value = null
    uploadFileName.value = ''
    // 重置文件 input
    const fileInput = document.getElementById('kb-file-input')
    if (fileInput) fileInput.value = ''

    await refreshStatus()
    await loadDocuments()
  } catch (err) {
    errorMessage.value = err.message
  } finally {
    uploadLoading.value = false
    uploadProgressText.value = ''
  }
}

// 删除文档
async function handleDeleteDoc(doc) {
  if (!confirm(`确认要从 Milvus 中彻底删除文档 [${doc.file_name}] 及其所有向量切片吗？`)) {
    return
  }
  try {
    await deleteKbDocument(doc.doc_id)
    successMessage.value = `文档 [${doc.file_name}] 已成功删除`
    await refreshStatus()
    await loadDocuments()
  } catch (err) {
    errorMessage.value = err.message
  }
}

// 查看切片明细
async function handleInspectDoc(doc) {
  inspectingDoc.value = doc
  chunksList.value = []
  chunksLoading.value = true
  try {
    chunksList.value = await fetchKbChunks(doc.doc_id)
  } catch (err) {
    alert('加载切片失败: ' + err.message)
  } finally {
    chunksLoading.value = false
  }
}

function toggleParentExpand(chunkId) {
  expandedParents[chunkId] = !expandedParents[chunkId]
}

// 执行检索
async function handleSearch() {
  if (!searchForm.query.trim()) {
    searchError.value = '请输入检索问题'
    return
  }
  searchLoading.value = true
  searchError.value = ''
  searchResult.value = null

  try {
    searchResult.value = await searchKnowledgeBase({
      query: searchForm.query.trim(),
      mode: searchForm.mode,
      top_k: Number(searchForm.top_k),
      coarse_top_k: Number(searchForm.coarse_top_k),
      enable_rewrite: searchForm.enable_rewrite,
      enable_hyde: searchForm.enable_hyde,
      enable_multi_query: searchForm.enable_multi_query,
      enable_rerank: searchForm.enable_rerank,
      enable_lost_in_middle: searchForm.enable_lost_in_middle,
      generate_answer: searchForm.generate_answer,
    })
  } catch (err) {
    searchError.value = err.message
  } finally {
    searchLoading.value = false
  }
}

function setQuery(q) {
  searchForm.query = q
}

// 格式化文件大小
function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
}
</script>

<template>
  <div class="kb-container">
    <!-- 顶部状态栏看板 -->
    <div class="status-board">
      <div class="stat-pill">
        <span class="dot" :class="{ ok: status?.milvus_connected }"></span>
        <span class="label">Milvus 向量库:</span>
        <strong>{{ status?.milvus_connected ? '正常运行' : '连接检测中' }}</strong>
        <span class="detail">({{ status?.total_chunks ?? 0 }} 个向量 · 19530)</span>
      </div>
      <div class="stat-pill">
        <span class="dot" :class="{ ok: status?.embed_connected }"></span>
        <span class="label">向量模型:</span>
        <strong>{{ status?.embed_model }}</strong>
        <span class="detail">({{ status?.embed_dim }}维 · Ollama)</span>
      </div>
      <div class="stat-pill">
        <span class="dot" :class="{ ok: status?.llm_enabled }"></span>
        <span class="label">推理 LLM:</span>
        <strong>{{ status?.llm_enabled ? status?.llm_model : '离线模式' }}</strong>
      </div>
      <button class="btn-refresh" :disabled="statusLoading" @click="refreshStatus">
        {{ statusLoading ? '…' : '刷新状态' }}
      </button>
    </div>

    <!-- 主选项卡切换 -->
    <div class="sub-nav">
      <button
        class="sub-tab"
        :class="{ active: activeTab === 'playground' }"
        @click="activeTab = 'playground'"
      >
        🔍 检索与问答实验台
      </button>
      <button
        class="sub-tab"
        :class="{ active: activeTab === 'documents' }"
        @click="activeTab = 'documents'"
      >
        📁 知识库文档与切块入库 ({{ documents.length }})
      </button>
    </div>

    <!-- 消息提示 -->
    <div v-if="errorMessage" class="banner error-banner">⚠️ {{ errorMessage }}</div>
    <div v-if="successMessage" class="banner success-banner">✅ {{ successMessage }}</div>

    <!-- ======================= 视图 1：检索与问答实验台 ======================= -->
    <div v-if="activeTab === 'playground'" class="playground-layout">
      <!-- 检索配置侧边栏/控制区 -->
      <div class="card search-control-card">
        <h3>🎯 检索与后处理策略调优</h3>

        <div class="control-group">
          <label class="group-title">检索模式 (Retrieval Mode)</label>
          <div class="mode-options">
            <label class="radio-label">
              <input v-model="searchForm.mode" type="radio" value="hybrid" />
              <span><strong>混合检索 (推荐)</strong><small>Dense向量 + BM25关键词 + RRF无偏融合</small></span>
            </label>
            <label class="radio-label">
              <input v-model="searchForm.mode" type="radio" value="dense" />
              <span><strong>仅密集向量检索</strong><small>基于 BGE-M3 余弦语义相似度</small></span>
            </label>
            <label class="radio-label">
              <input v-model="searchForm.mode" type="radio" value="bm25" />
              <span><strong>仅 BM25 关键词检索</strong><small>Jieba 中文分词精确字面匹配</small></span>
            </label>
          </div>
        </div>

        <div class="control-group">
          <label class="group-title">🔍 查询转换 (Query Transformation)</label>
          <div class="switch-grid">
            <label class="checkbox-label" title="用 LLM 纠正拼写、展开缩写、补充缺失上下文">
              <input v-model="searchForm.enable_rewrite" type="checkbox" />
              <span>查询重写 (Rewrite)</span>
            </label>
            <label class="checkbox-label" title="生成假设性权威文档并进行向量检索，缩小语义鸿沟">
              <input v-model="searchForm.enable_hyde" type="checkbox" />
              <span>HyDE 假想文档检索</span>
            </label>
            <label class="checkbox-label" title="将复杂问题从 3 个角度分解为子查询联合召回">
              <input v-model="searchForm.enable_multi_query" type="checkbox" />
              <span>多查询分解 (Multi-Query)</span>
            </label>
          </div>
        </div>

        <div class="control-group">
          <label class="group-title">⚡ 精排序与后处理 (Rerank & Post-process)</label>
          <div class="switch-grid">
            <label class="checkbox-label" title="Cross-Encoder 对粗召回候选进行交叉注意力精细打分">
              <input v-model="searchForm.enable_rerank" type="checkbox" />
              <span>两阶段重排序 (Rerank)</span>
            </label>
            <label class="checkbox-label" title="通过首尾放置最相关切片，缓解 LLM 中间注意力衰减">
              <input v-model="searchForm.enable_lost_in_middle" type="checkbox" />
              <span>解决中间丢失 (Lost in Middle)</span>
            </label>
            <label class="checkbox-label">
              <input v-model="searchForm.generate_answer" type="checkbox" />
              <span>生成结构化 AI 回答</span>
            </label>
          </div>
        </div>

        <div class="control-group row-inputs">
          <div class="field">
            <label>精选 Top-K 切片:</label>
            <input v-model.number="searchForm.top_k" type="number" min="1" max="20" />
          </div>
          <div class="field">
            <label>粗召回候选池:</label>
            <input v-model.number="searchForm.coarse_top_k" type="number" min="5" max="100" />
          </div>
        </div>
      </div>

      <!-- 提问与结果展示区 -->
      <div class="search-main-card card">
        <form @submit.prevent="handleSearch">
          <div class="search-bar">
            <input
              v-model="searchForm.query"
              type="text"
              placeholder="请输入检索问题，例如：RAG切块策略有哪几种？BM25和向量检索如何融合？"
              :disabled="searchLoading"
            />
            <button type="submit" class="btn-primary" :disabled="searchLoading">
              {{ searchLoading ? '执行全链路检索中…' : '检索 / 问答' }}
            </button>
          </div>
        </form>

        <div class="quick-samples">
          <span class="sample-label">示例提问：</span>
          <span
            v-for="(q, idx) in sampleQueries"
            :key="idx"
            class="sample-tag"
            @click="setQuery(q)"
          >
            {{ q }}
          </span>
        </div>

        <div v-if="searchError" class="banner error-banner mt-3">{{ searchError }}</div>

        <!-- 检索流水线轨迹展示 (Pipeline Trace) -->
        <div v-if="searchResult?.trace" class="pipeline-trace">
          <div class="trace-header">
            <h4>⚙️ 检索链路执行明细</h4>
            <span class="trace-time">耗时: {{ searchResult.execution_time_ms }} ms</span>
          </div>

          <div class="trace-steps">
            <div class="step-item">
              <span class="step-badge">1. 查询</span>
              <span class="step-desc">
                原始: <code>"{{ searchResult.trace.original_query }}"</code>
                <template v-if="searchResult.trace.rewritten_query">
                  → 重写为: <code>"{{ searchResult.trace.rewritten_query }}"</code>
                </template>
              </span>
            </div>

            <div v-if="searchResult.trace.hyde_document" class="step-item">
              <span class="step-badge hyde">HyDE 假想文档</span>
              <span class="step-desc">{{ searchResult.trace.hyde_document }}</span>
            </div>

            <div v-if="searchResult.trace.multi_queries?.length" class="step-item">
              <span class="step-badge multi">Multi-Query</span>
              <span class="step-desc">
                生成 3 个子查询: {{ searchResult.trace.multi_queries.join(' | ') }}
              </span>
            </div>

            <div class="step-item">
              <span class="step-badge召回">2. 多路召回</span>
              <span class="step-desc">
                Dense 向量召回: <strong>{{ searchResult.trace.dense_candidates_count }}</strong> 条 ·
                BM25 关键词召回: <strong>{{ searchResult.trace.bm25_candidates_count }}</strong> 条
                <template v-if="searchResult.trace.rrf_candidates_count">
                  · RRF 融合候选: <strong>{{ searchResult.trace.rrf_candidates_count }}</strong> 条
                </template>
              </span>
            </div>

            <div class="step-item">
              <span class="step-badge re">3. 精排与后处理</span>
              <span class="step-desc">
                两阶段 Rerank: <strong>{{ searchResult.trace.rerank_applied ? '已执行精排打分' : '已跳过' }}</strong> ·
                解决中间丢失重排: <strong>{{ searchResult.trace.lost_in_middle_applied ? '首尾重排已优化' : '未开启' }}</strong>
              </span>
            </div>
          </div>
        </div>

        <!-- 大模型 RAG 回答卡片 -->
        <div v-if="searchResult?.answer" class="rag-answer-box">
          <div class="answer-header">
            <span class="answer-title">💡 知识库智能综合答复</span>
            <span class="answer-tag">基于 {{ searchResult.chunks?.length }} 个高相关切片生成</span>
          </div>
          <div class="answer-content">{{ searchResult.answer }}</div>
        </div>

        <!-- 召回切片列表 -->
        <div v-if="searchResult?.chunks" class="chunks-section">
          <h4>📑 召回与精排切片证据列表 (Top {{ searchResult.chunks.length }})</h4>

          <div v-if="searchResult.chunks.length === 0" class="empty-hint">
            未召回相关切片，请尝试调整查询词或重新上传入库文档。
          </div>

          <div
            v-for="(chunk, idx) in searchResult.chunks"
            :key="chunk.chunk_id"
            class="chunk-card"
          >
            <div class="chunk-card-head">
              <div class="head-left">
                <span class="rank-badge">#{{ chunk.final_rank || (idx + 1) }}</span>
                <span class="chunk-file">📄 {{ chunk.file_name }}</span>
                <span class="chunk-type-tag">{{ chunk.chunk_type }}</span>
                <span v-if="chunk.metadata?.page" class="meta-tag">第 {{ chunk.metadata.page }} 页</span>
                <span v-if="chunk.metadata?.sheet_name" class="meta-tag">工作表: {{ chunk.metadata.sheet_name }}</span>
              </div>
              <div class="head-right">
                <span v-if="chunk.rerank_score != null" class="score-pill rerank">
                  Rerank得分: {{ chunk.rerank_score }}
                </span>
                <span v-if="chunk.rrf_score != null" class="score-pill rrf">
                  RRF得分: {{ chunk.rrf_score }}
                </span>
                <span v-if="chunk.dense_score != null" class="score-pill dense">
                  向量余弦: {{ chunk.dense_score }}
                </span>
                <span v-if="chunk.bm25_score != null" class="score-pill bm25">
                  BM25: {{ chunk.bm25_score }}
                </span>
              </div>
            </div>

            <div class="chunk-text">{{ chunk.text }}</div>

            <!-- 父子切块回溯父级上下文 -->
            <div v-if="chunk.parent_text" class="parent-context-box">
              <button
                type="button"
                class="btn-toggle-parent"
                @click="toggleParentExpand(chunk.chunk_id)"
              >
                {{ expandedParents[chunk.chunk_id] ? '收起父级大块全景上下文 ▲' : '查看对应的父级完整上下文 ▼' }}
              </button>
              <div v-if="expandedParents[chunk.chunk_id]" class="parent-text-preview">
                <div class="parent-tip">📌 检索由子块精准命中，以下为注入 LLM 的完整父级语境：</div>
                {{ chunk.parent_text }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ======================= 视图 2：知识库文档与切块入库 ======================= -->
    <div v-if="activeTab === 'documents'" class="documents-layout">
      <!-- 上传与切块参数面板 -->
      <div class="card upload-card">
        <h3>📤 上传新文档至知识库</h3>
        <p class="subtitle">
          支持 PDF、Word (.docx/.doc)、Excel (.xlsx/.xls/.csv)、Markdown (.md)、TXT 等多格式文件解析与清洗。
        </p>

        <!-- 拖拽上传区 -->
        <div
          class="drop-zone"
          :class="{ active: !!uploadFile }"
          @dragover.prevent
          @drop="handleDrop"
          @click="$refs.fileInput.click()"
        >
          <input
            id="kb-file-input"
            ref="fileInput"
            type="file"
            accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.markdown,.json"
            style="display: none"
            @change="handleFileChange"
          />
          <div v-if="!uploadFile" class="drop-prompt">
            <span class="drop-icon">📁</span>
            <p><strong>点击选择文件</strong> 或直接将文件拖拽至此处</p>
            <span class="file-types">支持 PDF / DOCX / EXCEL / MD / TXT</span>
          </div>
          <div v-else class="selected-file">
            <span class="file-icon">📄</span>
            <span class="file-name">{{ uploadFileName }}</span>
            <span class="file-size">({{ formatBytes(uploadFile.size) }})</span>
            <button
              type="button"
              class="btn-clear-file"
              @click.stop="uploadFile = null; uploadFileName = ''"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- 切块策略选择 -->
        <div class="strategy-section">
          <label class="group-title">切块策略选择 (Chunking Strategy):</label>
          <div class="strategy-cards">
            <div
              class="strategy-card"
              :class="{ selected: uploadForm.strategy === 'recursive' }"
              @click="uploadForm.strategy = 'recursive'"
            >
              <div class="strategy-header">
                <strong>递归字符切块 (通用默认)</strong>
                <span class="badge">推荐</span>
              </div>
              <p>按段落、句子递归切割，保持语义连贯性，并保留 10%~20% 重叠区避免跨块语义丢失。</p>
            </div>

            <div
              class="strategy-card"
              :class="{ selected: uploadForm.strategy === 'semantic' }"
              @click="uploadForm.strategy = 'semantic'"
            >
              <div class="strategy-header">
                <strong>语义切块 (高精度)</strong>
                <span class="badge sem">深度理解</span>
              </div>
              <p>利用 BGE-M3 嵌入模型计算相邻句子的语义相似度跳变点，在语义转折处切分。</p>
            </div>

            <div
              class="strategy-card"
              :class="{ selected: uploadForm.strategy === 'hierarchical' }"
              @click="uploadForm.strategy = 'hierarchical'"
            >
              <div class="strategy-header">
                <strong>父子层级切块 (高召回+保上下文)</strong>
                <span class="badge hier">企业级高级</span>
              </div>
              <p>小块（子块）用于高精密集检索，命中后回溯其对应的大块（父块）输入 LLM，兼顾精度与上下文。</p>
            </div>
          </div>

          <!-- 对应参数微调区 -->
          <div class="params-panel">
            <template v-if="uploadForm.strategy === 'recursive'">
              <div class="param-row">
                <label>切块大小 (tokens/字数): <strong>{{ uploadForm.chunk_size }}</strong></label>
                <input v-model.number="uploadForm.chunk_size" type="range" min="200" max="1000" step="50" />
              </div>
              <div class="param-row">
                <label>相邻重叠度 (Overlap): <strong>{{ uploadForm.chunk_overlap }} ({{ Math.round((uploadForm.chunk_overlap/uploadForm.chunk_size)*100) }}%)</strong></label>
                <input v-model.number="uploadForm.chunk_overlap" type="range" min="20" max="200" step="10" />
              </div>
            </template>

            <template v-else-if="uploadForm.strategy === 'semantic'">
              <div class="param-row">
                <label>语义跳变阈值分位数: <strong>{{ uploadForm.breakpoint_percentile_threshold }}%</strong></label>
                <input v-model.number="uploadForm.breakpoint_percentile_threshold" type="range" min="70" max="99" step="1" />
                <small class="param-tip">分位数越高，切割点越严苛，切片篇幅越大</small>
              </div>
            </template>

            <template v-else-if="uploadForm.strategy === 'hierarchical'">
              <div class="param-row">
                <label>父块全景大小 (Parent Chunk): <strong>{{ uploadForm.parent_chunk_size }} 字</strong></label>
                <input v-model.number="uploadForm.parent_chunk_size" type="range" min="600" max="2000" step="100" />
              </div>
              <div class="param-row">
                <label>子块检索大小 (Child Chunk): <strong>{{ uploadForm.child_chunk_size }} 字</strong></label>
                <input v-model.number="uploadForm.child_chunk_size" type="range" min="150" max="500" step="50" />
              </div>
            </template>
          </div>
        </div>

        <div class="upload-action">
          <button
            class="btn-primary btn-upload"
            :disabled="!uploadFile || uploadLoading"
            @click="handleUpload"
          >
            {{ uploadLoading ? '处理中…' : '开始切块并向量化存储到 Milvus' }}
          </button>
          <span v-if="uploadProgressText" class="progress-text">{{ uploadProgressText }}</span>
        </div>
      </div>

      <!-- 已入库文档管理列表 -->
      <div class="card doc-list-card">
        <div class="list-head">
          <h3>📚 知识库已入库文档 ({{ documents.length }})</h3>
          <button class="btn-refresh" :disabled="docsLoading" @click="loadDocuments">
            {{ docsLoading ? '刷新中…' : '刷新列表' }}
          </button>
        </div>

        <div v-if="documents.length === 0" class="empty-list">
          暂无文档。请在上方上传文件以构建知识库。
        </div>

        <div v-else class="table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th>文档名称</th>
                <th>类型</th>
                <th>切块策略</th>
                <th>切片数量</th>
                <th>文件大小</th>
                <th>入库时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="doc in documents" :key="doc.doc_id">
                <td class="td-filename">
                  <strong>{{ doc.file_name }}</strong>
                </td>
                <td><span class="type-pill">{{ doc.file_type.toUpperCase() }}</span></td>
                <td>
                  <span v-if="doc.strategy === 'recursive'" class="strat-tag">递归切块</span>
                  <span v-else-if="doc.strategy === 'semantic'" class="strat-tag sem">语义切块</span>
                  <span v-else-if="doc.strategy === 'hierarchical'" class="strat-tag hier">父子切块</span>
                  <span v-else class="strat-tag">{{ doc.strategy }}</span>
                </td>
                <td><strong>{{ doc.chunk_count }}</strong> 块</td>
                <td>{{ formatBytes(doc.file_size) }}</td>
                <td class="time-col">{{ doc.created_at }}</td>
                <td class="action-col">
                  <button class="btn-action view" @click="handleInspectDoc(doc)">查看切片</button>
                  <button class="btn-action del" @click="handleDeleteDoc(doc)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 查看切片明细抽屉 / 模态框 -->
    <div v-if="inspectingDoc" class="modal-backdrop" @click="inspectingDoc = null">
      <div class="modal-content card" @click.stop>
        <div class="modal-head">
          <div>
            <h3>切片明细 - {{ inspectingDoc.file_name }}</h3>
            <p class="subtitle">共 {{ chunksList.length }} 个文本切块，存储于 Milvus</p>
          </div>
          <button class="btn-close" @click="inspectingDoc = null">✕</button>
        </div>

        <div v-if="chunksLoading" class="modal-loading">正在读取切片数据…</div>

        <div v-else class="modal-body">
          <div v-for="chunk in chunksList" :key="chunk.chunk_id" class="chunk-item">
            <div class="chunk-item-head">
              <span class="chunk-num">切块 #{{ chunk.chunk_index + 1 }}</span>
              <span class="chunk-type-pill">{{ chunk.chunk_type }}</span>
              <span v-if="chunk.parent_id" class="parent-pill">父块: {{ chunk.parent_id }}</span>
              <span class="chunk-len">{{ chunk.text.length }} 字符</span>
            </div>
            <div class="chunk-item-text">{{ chunk.text }}</div>

            <!-- 父级展开 -->
            <div v-if="chunk.parent_text" class="parent-box">
              <button
                class="btn-toggle-parent small"
                @click="toggleParentExpand(chunk.chunk_id)"
              >
                {{ expandedParents[chunk.chunk_id] ? '收起父级大块全景 ▲' : '查看关联父级大块 (用于生成上下文) ▼' }}
              </button>
              <div v-if="expandedParents[chunk.chunk_id]" class="parent-full-text">
                {{ chunk.parent_text }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kb-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 顶部状态看板 */
.status-board {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  background: #ffffff;
  border: 1px solid var(--line);
  padding: 12px 18px;
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);
}

.stat-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink);
  background: #f8fafc;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid #edf2f7;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd5e1;
}

.dot.ok {
  background: var(--ok);
  box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.2);
}

.label {
  color: var(--ink-soft);
}

.detail {
  color: #94a3b8;
  font-size: 11px;
}

.btn-refresh {
  margin-left: auto;
  border: 1px solid var(--line);
  background: #fff;
  padding: 6px 14px;
  font-size: 12px;
  border-radius: 999px;
  color: var(--ink-soft);
  transition: all 0.2s;
}

.btn-refresh:hover {
  color: var(--brand);
  border-color: var(--brand);
}

/* 子导航切换 */
.sub-nav {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  background: #e2e8f0;
  border-radius: 999px;
  align-self: flex-start;
}

.sub-tab {
  border: none;
  background: transparent;
  padding: 8px 20px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-soft);
  transition: all 0.2s;
}

.sub-tab.active {
  background: var(--brand);
  color: #fff;
  box-shadow: 0 2px 8px rgba(79, 109, 245, 0.3);
}

/* 消息提示横幅 */
.banner {
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
}

.error-banner {
  color: var(--bad);
  background: #fdeaea;
  border: 1px solid #fca5a5;
}

.success-banner {
  color: var(--ok);
  background: #e8f7ee;
  border: 1px solid #86efac;
}

/* ================== 检索实验台样式 ================== */
.playground-layout {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 20px;
}

@media (max-width: 900px) {
  .playground-layout {
    grid-template-columns: 1fr;
  }
}

.search-control-card {
  padding: 22px;
  height: fit-content;
}

.search-control-card h3 {
  margin: 0 0 16px;
  font-size: 17px;
  font-weight: 700;
}

.control-group {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--line);
}

.control-group:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.group-title {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 10px;
}

.mode-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radio-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: pointer;
  background: #fafbfc;
  transition: all 0.2s;
}

.radio-label:hover {
  background: #f1f5f9;
}

.radio-label input {
  margin-top: 3px;
}

.radio-label span {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}

.radio-label small {
  font-size: 11px;
  color: var(--ink-soft);
  margin-top: 2px;
}

.switch-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.row-inputs {
  display: flex;
  gap: 14px;
}

.row-inputs .field {
  flex: 1;
}

.row-inputs label {
  display: block;
  font-size: 12px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}

.row-inputs input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 13px;
}

/* 检索主操作区 */
.search-main-card {
  padding: 24px;
}

.search-bar {
  display: flex;
  gap: 12px;
}

.search-bar input {
  flex: 1;
  padding: 12px 18px;
  border: 2px solid var(--line);
  border-radius: 12px;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
}

.search-bar input:focus {
  border-color: var(--brand);
}

.btn-primary {
  padding: 12px 24px;
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  transition: background 0.2s;
  white-space: nowrap;
}

.btn-primary:hover:not(:disabled) {
  background: var(--brand-dark);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.quick-samples {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.sample-label {
  color: var(--ink-soft);
}

.sample-tag {
  background: #f1f5f9;
  color: var(--brand);
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.sample-tag:hover {
  background: #e2e8f0;
}

/* 检索链路轨迹 */
.pipeline-trace {
  margin-top: 20px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px 20px;
}

.trace-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.trace-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}

.trace-time {
  font-size: 12px;
  font-weight: 600;
  color: var(--ok);
  background: #e8f7ee;
  padding: 3px 8px;
  border-radius: 6px;
}

.trace-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
  line-height: 1.5;
}

.step-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  background: #e2e8f0;
  color: var(--ink);
  white-space: nowrap;
}

.step-badge.hyde {
  background: #e0e7ff;
  color: #4338ca;
}

.step-badge.multi {
  background: #fef3c7;
  color: #b45309;
}

.step-badge.re {
  background: #fce7f3;
  color: #be185d;
}

.step-desc code {
  background: #edf2f7;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}

/* RAG 答复卡片 */
.rag-answer-box {
  margin-top: 24px;
  background: linear-gradient(135deg, #f5f8ff 0%, #ffffff 100%);
  border: 1.5px solid #dbeafe;
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.06);
}

.answer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.answer-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--brand);
}

.answer-tag {
  font-size: 11px;
  color: #64748b;
  background: #e2e8f0;
  padding: 3px 8px;
  border-radius: 6px;
}

.answer-content {
  font-size: 15px;
  line-height: 1.7;
  color: #1e293b;
  white-space: pre-wrap;
}

/* 召回切片 */
.chunks-section {
  margin-top: 28px;
}

.chunks-section h4 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 700;
}

.empty-hint {
  text-align: center;
  padding: 30px;
  color: var(--ink-soft);
  font-size: 14px;
}

.chunk-card {
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 14px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
}

.chunk-card-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.rank-badge {
  background: var(--brand);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
}

.chunk-file {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.chunk-type-tag {
  font-size: 11px;
  background: #f1f5f9;
  color: #475569;
  padding: 2px 6px;
  border-radius: 4px;
}

.meta-tag {
  font-size: 11px;
  background: #eff6ff;
  color: #2563eb;
  padding: 2px 6px;
  border-radius: 4px;
}

.head-right {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.score-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
}

.score-pill.rerank {
  background: #fdf2f8;
  color: #db2777;
  border: 1px solid #fbcfe8;
}

.score-pill.rrf {
  background: #f0fdf4;
  color: #16a34a;
  border: 1px solid #bbf7d0;
}

.score-pill.dense {
  background: #eff6ff;
  color: #2563eb;
}

.score-pill.bm25 {
  background: #fefce8;
  color: #ca8a04;
}

.chunk-text {
  font-size: 14px;
  line-height: 1.65;
  color: #334155;
  background: #f8fafc;
  padding: 12px 14px;
  border-radius: 8px;
  white-space: pre-wrap;
}

.parent-context-box {
  margin-top: 10px;
}

.btn-toggle-parent {
  border: none;
  background: transparent;
  color: var(--brand);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 0;
  cursor: pointer;
}

.btn-toggle-parent.small {
  font-size: 11px;
}

.parent-text-preview,
.parent-full-text {
  margin-top: 8px;
  padding: 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: #78350f;
  white-space: pre-wrap;
}

.parent-tip {
  font-weight: 700;
  font-size: 12px;
  margin-bottom: 6px;
  color: #b45309;
}

/* ================== 文档入库与管理样式 ================== */
.documents-layout {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.upload-card h3,
.doc-list-card h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.upload-card .subtitle {
  margin: 6px 0 16px;
  font-size: 13px;
  color: var(--ink-soft);
}

.drop-zone {
  border: 2px dashed #cbd5e1;
  background: #f8fafc;
  border-radius: 14px;
  padding: 32px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.drop-zone:hover {
  border-color: var(--brand);
  background: #f0f5ff;
}

.drop-zone.active {
  border-color: var(--brand);
  background: #eef2ff;
}

.drop-icon {
  font-size: 36px;
  display: block;
  margin-bottom: 8px;
}

.drop-prompt p {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--ink);
}

.file-types {
  font-size: 12px;
  color: var(--ink-soft);
}

.selected-file {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--brand);
}

.btn-clear-file {
  background: #fee2e2;
  color: #ef4444;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  font-size: 12px;
  cursor: pointer;
}

/* 切块策略选择卡片 */
.strategy-section {
  margin-top: 24px;
}

.strategy-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
  margin-top: 10px;
}

.strategy-card {
  border: 1.5px solid var(--line);
  background: #ffffff;
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.strategy-card:hover {
  border-color: #93c5fd;
}

.strategy-card.selected {
  border-color: var(--brand);
  background: #f8faff;
  box-shadow: 0 4px 12px rgba(79, 109, 245, 0.1);
}

.strategy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 14px;
}

.strategy-header .badge {
  font-size: 11px;
  background: #dbeafe;
  color: #1d4ed8;
  padding: 2px 7px;
  border-radius: 999px;
  font-weight: 600;
}

.strategy-header .badge.sem {
  background: #fef3c7;
  color: #92400e;
}

.strategy-header .badge.hier {
  background: #fce7f3;
  color: #9d174d;
}

.strategy-card p {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.5;
}

.params-panel {
  margin-top: 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.param-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-row label {
  font-size: 13px;
  color: var(--ink);
}

.param-row input[type="range"] {
  width: 100%;
}

.param-tip {
  font-size: 11px;
  color: var(--ink-soft);
}

.upload-action {
  margin-top: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.btn-upload {
  padding: 14px 28px;
  font-size: 15px;
}

.progress-text {
  font-size: 13px;
  color: var(--brand);
  font-weight: 600;
  animation: pulse 1.5s infinite ease-in-out;
}

@keyframes pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

/* 文档列表表格 */
.list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.table-wrap {
  overflow-x: auto;
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.doc-table th {
  text-align: left;
  padding: 12px 14px;
  background: #f8fafc;
  border-bottom: 2px solid var(--line);
  color: var(--ink-soft);
  font-weight: 600;
}

.doc-table td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}

.td-filename {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-pill {
  font-size: 11px;
  font-weight: 700;
  background: #e2e8f0;
  padding: 2px 6px;
  border-radius: 4px;
}

.strat-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #e0f2fe;
  color: #0369a1;
}

.strat-tag.sem {
  background: #fef3c7;
  color: #b45309;
}

.strat-tag.hier {
  background: #fce7f3;
  color: #be185d;
}

.time-col {
  color: var(--ink-soft);
  font-size: 12px;
  white-space: nowrap;
}

.action-col {
  white-space: nowrap;
}

.btn-action {
  border: none;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-action.view {
  color: var(--brand);
}

.btn-action.view:hover {
  background: #eff6ff;
}

.btn-action.del {
  color: var(--bad);
}

.btn-action.del:hover {
  background: #fee2e2;
}

.empty-list {
  text-align: center;
  padding: 40px;
  color: var(--ink-soft);
  font-size: 14px;
}

/* 模态弹窗 */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  width: 100%;
  max-width: 760px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  padding: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.modal-head h3 {
  margin: 0;
  font-size: 18px;
}

.btn-close {
  border: none;
  background: #f1f5f9;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
}

.modal-loading {
  padding: 40px;
  text-align: center;
  color: var(--ink-soft);
}

.modal-body {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chunk-item {
  border: 1px solid var(--line);
  background: #fafbfc;
  border-radius: 8px;
  padding: 12px;
}

.chunk-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.chunk-num {
  font-weight: 700;
  font-size: 12px;
  color: var(--ink);
}

.chunk-type-pill {
  font-size: 10px;
  background: #e2e8f0;
  padding: 1px 6px;
  border-radius: 4px;
}

.parent-pill {
  font-size: 10px;
  background: #fef3c7;
  color: #92400e;
  padding: 1px 6px;
  border-radius: 4px;
}

.chunk-len {
  margin-left: auto;
  font-size: 11px;
  color: #94a3b8;
}

.chunk-item-text {
  font-size: 13px;
  line-height: 1.6;
  color: #334155;
  white-space: pre-wrap;
}
</style>
