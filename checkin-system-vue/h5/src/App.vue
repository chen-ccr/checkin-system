<script setup>
import { ref, onMounted } from 'vue'
import { ensureLogin } from './utils/auth'
import { getLocation } from './utils/location'

const user = ref(null)
const plan = ref([])
const history = ref([])
const msg = ref('')
const precheckMsg = ref('')
const loading = ref(false)
const syncMsg = ref('')

const OFFLINE_KEY = 'checkin_offline_queue'
const API_BASE = '/api/v1'

function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]')
  } catch (_err) {
    return []
  }
}

function setQueue(items) {
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(items))
}

function createIdempotencyKey(item) {
  return `${item.userId}-${item.punchedAt}-${Math.random().toString(16).slice(2, 8)}`
}

async function loadPlan() {
  const res = await fetch(`${API_BASE}/checkins/plan?userId=${encodeURIComponent(user.value.userId)}`)
  const data = await res.json()
  plan.value = data.data.nodes || []
}

async function loadHistory() {
  const res = await fetch(`${API_BASE}/checkins/history?userId=${encodeURIComponent(user.value.userId)}&limit=20`)
  const data = await res.json()
  history.value = data.data.records || []
}

async function syncOfflineQueue() {
  const queue = getQueue()
  if (!queue.length) {
    syncMsg.value = ''
    return
  }
  try {
    const res = await fetch(`${API_BASE}/checkins/offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: queue })
    })
    const data = await res.json()
    if (data.code === 'OK') {
      setQueue([])
      syncMsg.value = `离线补传成功，共 ${queue.length} 条`
      await loadPlan()
      await loadHistory()
    } else {
      syncMsg.value = '离线补传失败，稍后重试'
    }
  } catch (_err) {
    syncMsg.value = '网络未恢复，离线记录待补传'
  }
}

async function checkFence(loc) {
  const res = await fetch(`${API_BASE}/checkins/precheck`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: user.value.userId,
      lat: loc.lat,
      lng: loc.lng
    })
  })
  const data = await res.json()
  if (data.code !== 'OK') {
    throw new Error(data.message || '围栏校验失败')
  }
  precheckMsg.value = `${data.data.fenceName}：${data.data.message}，偏移 ${data.data.distanceMeters}m`
  return data.data
}

async function handleCheckin() {
  if (loading.value) return
  loading.value = true
  msg.value = '正在定位并提交...'
  try {
    const loc = await getLocation()
    const precheck = await checkFence(loc)
    if (!precheck.inside) {
      msg.value = '当前位置不在打卡围栏内'
      return
    }
    const payload = {
      userId: user.value.userId,
      lat: loc.lat,
      lng: loc.lng
    }
    const res = await fetch(`${API_BASE}/checkins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json()
    if (data.code === 'OK') {
      msg.value = `${data.message}（第${data.data.punchIndex}节点，${data.data.status}）`
      await loadPlan()
      await loadHistory()
      await syncOfflineQueue()
      return
    }
    msg.value = data.message || '打卡失败'
  } catch (_error) {
    const loc = await getLocation()
    const offlineItem = {
      userId: user.value.userId,
      lat: loc.lat,
      lng: loc.lng,
      punchedAt: new Date().toISOString(),
      idempotencyKey: createIdempotencyKey({ userId: user.value.userId, punchedAt: new Date().toISOString() })
    }
    const queue = getQueue()
    queue.push(offlineItem)
    setQueue(queue)
    msg.value = '网络异常，已离线缓存，恢复网络后自动补传'
    syncMsg.value = `待补传 ${queue.length} 条`
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  user.value = await ensureLogin()
  await loadPlan()
  await loadHistory()
  await syncOfflineQueue()
  window.addEventListener('online', syncOfflineQueue)
})
</script>

<template>
  <div class="checkin-container">
    <h2>融媒体中心考勤打卡</h2>
    <div v-if="user" class="user-card">
      <p><strong>姓名：</strong>{{ user.name }}</p>
      <p><strong>工号：</strong>{{ user.userId }}</p>
      <p><strong>离线队列：</strong>{{ JSON.parse(localStorage.getItem('checkin_offline_queue') || '[]').length }} 条</p>
    </div>
    <div class="action-section">
      <button @click="handleCheckin" :disabled="loading" class="btn-checkin">{{ loading ? '处理中...' : '立即打卡' }}</button>
    </div>
    <p class="hint" v-if="precheckMsg">{{ precheckMsg }}</p>
    <p class="hint" v-if="syncMsg">{{ syncMsg }}</p>
    <div v-if="msg" class="result-msg" :class="{ error: msg.includes('失败') || msg.includes('异常') }">{{ msg }}</div>

    <div class="panel">
      <h3>今日应打卡节点</h3>
      <ul>
        <li v-for="node in plan" :key="node.punchIndex" :class="{ done: node.checked, abnormal: node.status === 'LATE' }">
          第{{ node.punchIndex }}次 {{ node.startTime }}-{{ node.endTime }} / 状态：{{ node.status }} {{ node.punchedAt ? `(${node.punchedAt})` : '' }}
        </li>
      </ul>
    </div>

    <div class="panel">
      <h3>历史记录</h3>
      <ul>
        <li v-for="item in history" :key="item.id" :class="{ abnormal: item.status === 'LATE' }">
          {{ item.biz_date }} 第{{ item.punch_index }}次 {{ item.punched_at }} {{ item.status }} {{ Number(item.is_offline) === 1 ? '离线上传' : '' }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.checkin-container { padding: 16px; max-width: 720px; margin: 0 auto; font-family: sans-serif; }
.user-card { background: #f5f7fb; padding: 12px; border-radius: 8px; margin-bottom: 12px; }
.action-section { margin-bottom: 12px; }
.btn-checkin { background: #1677ff; color: #fff; border: none; padding: 12px 20px; border-radius: 999px; font-size: 16px; }
.btn-checkin:disabled { opacity: 0.65; }
.result-msg { margin: 8px 0; padding: 8px 10px; background: #ecfdf3; color: #14532d; border-radius: 6px; }
.hint { margin: 6px 0; color: #334155; }
.error { background: #fef2f2; color: #991b1b; }
.panel { margin-top: 14px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #fff; }
ul { margin: 0; padding-left: 18px; }
li { margin-bottom: 6px; line-height: 1.5; }
.done { color: #14532d; }
.abnormal { color: #b45309; }
</style>
