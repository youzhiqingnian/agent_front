<script setup>
import { onMounted, ref } from 'vue'
import { fetchUserLoginLogs } from '../api'
import { authStore } from '../store/auth'

const logs = ref([])
const loadingLogs = ref(false)

onMounted(async () => {
  if (authStore.isAuthenticated.value) {
    loadingLogs.value = true
    try {
      logs.value = await fetchUserLoginLogs(8)
    } catch {
      // 忽略日志加载失败
    } finally {
      loadingLogs.value = false
    }
  }
})
</script>

<template>
  <div v-if="authStore.state.showProfileModal" class="modal-backdrop" @click.self="authStore.closeProfile()">
    <div class="profile-card">
      <button class="close-btn" type="button" @click="authStore.closeProfile()">✕</button>

      <div class="user-header">
        <img
          class="user-avatar"
          :src="authStore.state.user?.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=user'"
          alt="avatar"
        />
        <div class="user-meta">
          <div class="name-row">
            <h2>{{ authStore.state.user?.nickname || authStore.state.user?.username }}</h2>
            <span class="role-badge" :class="authStore.state.user?.role">
              {{ authStore.state.user?.role === 'admin' ? '🛡️ 管理员' : '👤 普通用户' }}
            </span>
          </div>
          <p class="user-handle">@{{ authStore.state.user?.username }}</p>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">电子邮箱</span>
          <span class="info-val">{{ authStore.state.user?.email || '未绑定' }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">绑定手机</span>
          <span class="info-val">{{ authStore.state.user?.phone || '未绑定' }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">账号状态</span>
          <span class="info-val status-active">● 正常运行</span>
        </div>
        <div class="info-item">
          <span class="info-label">注册时间</span>
          <span class="info-val">{{ authStore.state.user?.created_at || '未知' }}</span>
        </div>
      </div>

      <div class="logs-section">
        <h3>🕒 最近登录历史</h3>
        <div v-if="loadingLogs" class="loading-logs">正在加载登录日志…</div>
        <div v-else-if="logs.length === 0" class="empty-logs">暂无登录日志</div>
        <div v-else class="logs-table-wrap">
          <table class="logs-table">
            <thead>
              <tr>
                <th>登录时间</th>
                <th>设备</th>
                <th>IP 地址</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id">
                <td>{{ log.created_at }}</td>
                <td>{{ log.device || 'PC' }}</td>
                <td>{{ log.ip_address || '127.0.0.1' }}</td>
                <td>
                  <span class="res-tag" :class="log.status === 1 ? 'ok' : 'fail'">
                    {{ log.status === 1 ? '成功' : '失败' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="actions">
        <button class="logout-btn" type="button" @click="authStore.logout()">
          退出当前登录
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.profile-card {
  position: relative;
  width: 100%;
  max-width: 520px;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
  padding: 28px 24px;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  border: none;
  background: #f1f5f9;
  color: #64748b;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.user-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f1f5f9;
}

.user-avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: #e0e7ff;
  border: 2px solid #6366f1;
}

.user-meta h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.role-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
}

.role-badge.admin {
  background: #fef3c7;
  color: #b45309;
}

.role-badge.user {
  background: #e0f2fe;
  color: #0369a1;
}

.user-handle {
  margin: 2px 0 0;
  font-size: 13px;
  color: #64748b;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  background: #f8fafc;
  padding: 14px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-label {
  font-size: 12px;
  color: #64748b;
}

.info-val {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}

.status-active {
  color: #16a34a;
}

.logs-section h3 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.logs-table-wrap {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.logs-table th {
  background: #f8fafc;
  padding: 8px 10px;
  text-align: left;
  color: #64748b;
  font-weight: 600;
  border-bottom: 1px solid #e2e8f0;
}

.logs-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
}

.res-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.res-tag.ok {
  background: #dcfce7;
  color: #15803d;
}

.res-tag.fail {
  background: #fee2e2;
  color: #b91c1c;
}

.loading-logs, .empty-logs {
  font-size: 12px;
  color: #94a3b8;
  padding: 16px;
  text-align: center;
}

.actions {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.logout-btn {
  padding: 9px 18px;
  border: 1px solid #fecaca;
  background: #fff1f2;
  color: #e11d48;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
}

.logout-btn:hover {
  background: #ffe4e6;
  border-color: #fda4af;
}
</style>
