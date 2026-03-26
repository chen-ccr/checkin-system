<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { ensureLogin } from './utils/auth'
import { getLocation } from './utils/location'

const user = ref(null)
const plan = ref([])
const history = ref([])
const msg = ref('')
const precheckMsg = ref('')
const loading = ref(false)
const syncMsg = ref('')
const nowText = ref('')
const refreshing = ref(false)

const OFFLINE_KEY = 'checkin_offline_queue'
const API_BASE = '/api/v1'
let timerId = null

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

const queueCount = computed(() => getQueue().length)
const checkedCount = computed(() => plan.value.filter((item) => item.checked).length)
const pendingCount = computed(() => Math.max(0, plan.value.length - checkedCount.value))
const lateCount = computed(() => plan.value.filter((item) => item.status === 'LATE').length)
const nextNode = computed(() => plan.value.find((item) => !item.checked) || null)

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

async function refreshAll() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await loadPlan()
    await loadHistory()
    await syncOfflineQueue()
  } finally {
    refreshing.value = false
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
      await refreshAll()
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
  await refreshAll()
  window.addEventListener('online', syncOfflineQueue)
  nowText.value = new Date().toLocaleString()
  timerId = setInterval(() => {
    nowText.value = new Date().toLocaleString()
  }, 1000)
})

onUnmounted(() => {
  if (timerId) clearInterval(timerId)
  window.removeEventListener('online', syncOfflineQueue)
})
</script>

<template>
  <div class="page-bg">
    <div class="checkin-container">
      <header class="hero">
        <div>
          <h2>融媒体中心考勤打卡</h2>
          <p class="sub">{{ nowText }}</p>
        </div>
        <button class="btn-ghost" :disabled="refreshing" @click="refreshAll">{{ refreshing ? '刷新中...' : '刷新数据' }}</button>
      </header>

      <div v-if="user" class="user-card">
        <div>
          <p class="label">姓名</p>
          <p class="value">{{ user.name }}</p>
        </div>
        <div>
          <p class="label">工号</p>
          <p class="value">{{ user.userId }}</p>
        </div>
        <div>
          <p class="label">离线队列</p>
          <p class="value">{{ queueCount }} 条</p>
        </div>
      </div>

      <div class="metrics">
        <div class="metric"><span>今日节点</span><strong>{{ plan.length }}</strong></div>
        <div class="metric"><span>已完成</span><strong>{{ checkedCount }}</strong></div>
        <div class="metric"><span>待完成</span><strong>{{ pendingCount }}</strong></div>
        <div class="metric warning"><span>迟到</span><strong>{{ lateCount }}</strong></div>
      </div>

      <div class="next-card" v-if="nextNode">
        <p class="title">下一打卡节点</p>
        <p>第{{ nextNode.punchIndex }}次（{{ nextNode.startTime }} - {{ nextNode.endTime }}）</p>
      </div>

      <div class="action-section">
        <button @click="handleCheckin" :disabled="loading" class="btn-checkin">{{ loading ? '处理中...' : '立即打卡' }}</button>
        <button class="btn-second" :disabled="refreshing" @click="syncOfflineQueue">同步离线队列</button>
      </div>
      <p class="hint" v-if="precheckMsg">{{ precheckMsg }}</p>
      <p class="hint" v-if="syncMsg">{{ syncMsg }}</p>
      <div v-if="msg" class="result-msg" :class="{ error: msg.includes('失败') || msg.includes('异常') }">{{ msg }}</div>

      <div class="panel">
        <h3>今日应打卡节点</h3>
        <ul>
          <li v-for="node in plan" :key="node.punchIndex" :class="{ done: node.checked, abnormal: node.status === 'LATE' }">
            <div class="row-main">
              <span>第{{ node.punchIndex }}次 {{ node.startTime }}-{{ node.endTime }}</span>
              <span class="badge" :class="{ late: node.status === 'LATE', pending: node.status === 'PENDING' }">{{ node.status }}</span>
            </div>
            <div class="row-sub" v-if="node.punchedAt">打卡时间：{{ node.punchedAt }}</div>
          </li>
        </ul>
      </div>

      <div class="panel">
        <h3>历史记录</h3>
        <ul>
          <li v-for="item in history" :key="item.id" :class="{ abnormal: item.status === 'LATE' }">
            <div class="row-main">
              <span>{{ item.biz_date }} 第{{ item.punch_index }}次</span>
              <span class="badge" :class="{ late: item.status === 'LATE' }">{{ item.status }}</span>
            </div>
            <div class="row-sub">
              {{ item.punched_at }}
              <span v-if="Number(item.is_offline) === 1"> · 离线上传</span>
              <span v-if="item.fence_name"> · {{ item.fence_name }}</span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-bg { min-height: 100vh; background: linear-gradient(180deg, #f6faff 0%, #f8fafc 100%); }
.checkin-container { padding: 16px; max-width: 760px; margin: 0 auto; font-family: sans-serif; }
.hero { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sub { margin: 0; color: #64748b; font-size: 12px; }
.btn-ghost { border: 1px solid #cbd5e1; background: #fff; color: #1e293b; padding: 8px 12px; border-radius: 8px; }
.user-card { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); background: #fff; padding: 14px; border-radius: 12px; margin-bottom: 12px; border: 1px solid #e2e8f0; gap: 10px; }
.label { margin: 0; color: #64748b; font-size: 12px; }
.value { margin: 2px 0 0; color: #0f172a; font-size: 16px; font-weight: 700; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
.metric { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 4px; }
.metric span { color: #64748b; font-size: 12px; }
.metric strong { color: #0f172a; font-size: 20px; }
.metric.warning strong { color: #b45309; }
.next-card { margin-bottom: 12px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e3a8a; border-radius: 10px; padding: 10px 12px; }
.next-card .title { margin: 0 0 4px; font-weight: 700; }
.action-section { margin-bottom: 12px; display: flex; gap: 8px; }
.btn-checkin { background: #1677ff; color: #fff; border: none; padding: 12px 20px; border-radius: 999px; font-size: 16px; }
.btn-second { background: #fff; border: 1px solid #cbd5e1; color: #0f172a; padding: 12px 16px; border-radius: 999px; }
.btn-checkin:disabled, .btn-second:disabled, .btn-ghost:disabled { opacity: 0.65; }
.result-msg { margin: 8px 0; padding: 8px 10px; background: #ecfdf3; color: #14532d; border-radius: 6px; border: 1px solid #bbf7d0; }
.hint { margin: 6px 0; color: #334155; }
.error { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
.panel { margin-top: 14px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; background: #fff; }
ul { margin: 0; padding-left: 0; list-style: none; }
li { margin-bottom: 8px; line-height: 1.5; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px; }
li:last-child { margin-bottom: 0; border-bottom: 0; padding-bottom: 0; }
.row-main { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.row-sub { margin-top: 2px; font-size: 12px; color: #64748b; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #e2e8f0; color: #334155; }
.badge.pending { background: #f1f5f9; color: #475569; }
.badge.late { background: #ffedd5; color: #9a3412; }
.done { color: #14532d; }
.abnormal { color: #b45309; }
</style>
