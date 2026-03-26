<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { ensureLogin } from './utils/auth'
import { getLocation } from './utils/location'
import axios from 'axios'

const user = ref(null)
const authToken = ref('')
const currentTab = ref('checkin')
const plan = ref([])
const history = ref([])
const msg = ref('')
const precheckMsg = ref('')
const loading = ref(false)
const syncMsg = ref('')
const nowText = ref('')
const refreshing = ref(false)
const summaryLoading = ref(false)
const summaryMsg = ref('')
const canAccessSummary = ref(true)
const summaryLevel = ref('organization')
const summaryData = ref({
  range: {},
  summary: { expected: 0, actual: 0, late: 0, leave: 0 },
  rows: [],
  bars: [],
  records: []
})
const summaryMode = ref('day')
const summaryDate = ref(new Date().toISOString().slice(0, 10))
const customStartDate = ref(new Date().toISOString().slice(0, 10))
const customEndDate = ref(new Date().toISOString().slice(0, 10))
const calendarOpen = ref(false)
const selectedDepartment = ref(null)
const selectedUser = ref(null)

const OFFLINE_KEY = 'checkin_offline_queue'

// 和admin一样，使用相对路径 /api/v1
const api = axios.create({ baseURL: '/api/v1' })

console.log('=== App 初始化 ===')
console.log('API_BASE: /api/v1 (使用nginx代理，和admin一样)')

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

function setDefaultCustomRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  customStartDate.value = start.toISOString().slice(0, 10)
  customEndDate.value = now.toISOString().slice(0, 10)
}

const queueCount = computed(() => getQueue().length)
const checkedCount = computed(() => plan.value.filter((item) => item.checked).length)
const pendingCount = computed(() => Math.max(0, plan.value.length - checkedCount.value))
const lateCount = computed(() => plan.value.filter((item) => item.status === 'LATE').length)
const nextNode = computed(() => plan.value.find((item) => !item.checked) || null)
const summaryUnit = computed(() => (summaryLevel.value === 'user' ? '天' : '人'))
const chartMax = computed(() => {
  const values = summaryData.value.bars.flatMap((item) => [Number(item.expected || 0), Number(item.actual || 0)])
  const max = Math.max(...values, 0)
  return max > 0 ? max : 1
})

function barHeight(value) {
  return `${Math.max(8, Math.round((Number(value || 0) / chartMax.value) * 140))}px`
}

async function ensureSummaryToken() {
  if (!user.value?.userId) {
    throw new Error('用户未就绪，请稍后重试')
  }
  if (authToken.value) return authToken.value
  const res = await api.post('/auth/login', { userId: user.value.userId })
  authToken.value = res.data.data.token
  return authToken.value
}

async function loadSummaryAccess() {
  summaryMsg.value = ''
  try {
    const token = await ensureSummaryToken()
    const res = await api.get('/h5/attendance/access', {
      headers: { Authorization: `Bearer ${token}` }
    })
    canAccessSummary.value = true
  } catch (_error) {
    canAccessSummary.value = false
  }
}

async function loadPlan() {
  console.log('📡 loadPlan 开始，userId:', user.value?.userId)
  if (!user.value?.userId) {
    console.error('❌ loadPlan: user.value 或 userId 为空')
    return
  }
  try {
    const res = await api.get('/checkins/plan', {
      params: { userId: user.value.userId }
    })
    console.log('📡 loadPlan 返回:', res.data)
    plan.value = res.data.data.nodes || []
  } catch (err) {
    console.error('❌ loadPlan 错误:', err)
  }
}

async function loadHistory() {
  console.log('📡 loadHistory 开始')
  if (!user.value?.userId) {
    console.error('❌ loadHistory: user.value 或 userId 为空')
    return
  }
  try {
    const res = await api.get('/checkins/history', {
      params: { userId: user.value.userId, limit: 20 }
    })
    console.log('📡 loadHistory 返回:', res.data)
    history.value = res.data.data.records || []
  } catch (err) {
    console.error('❌ loadHistory 错误:', err)
  }
}

async function syncOfflineQueue() {
  const queue = getQueue()
  if (!queue.length) {
    syncMsg.value = ''
    return
  }
  try {
    const res = await api.post('/checkins/offline', { items: queue })
    if (res.data.code === 'OK') {
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

function buildSummaryQuery() {
  const params = {}
  params.mode = summaryMode.value
  if (summaryMode.value === 'custom') {
    if (customStartDate.value) params.startDate = customStartDate.value
    if (customEndDate.value) params.endDate = customEndDate.value
  } else if (summaryDate.value) {
    params.date = summaryDate.value
  }
  if (selectedDepartment.value?.id) params.departmentId = String(selectedDepartment.value.id)
  if (selectedUser.value?.id) params.userId = String(selectedUser.value.id)
  return params
}

async function loadSummary() {
  if (!user.value?.userId) return
  summaryLoading.value = true
  summaryMsg.value = ''
  try {
    const token = await ensureSummaryToken()
    const params = buildSummaryQuery()
    const res = await api.get('/h5/attendance/summary', {
      params,
      headers: { Authorization: `Bearer ${token}` }
    })
    summaryData.value = res.data.data
    summaryLevel.value = res.data.data.level || 'organization'
  } catch (error) {
    summaryMsg.value = error.message || '考勤汇总加载失败'
  } finally {
    summaryLoading.value = false
  }
}

async function openSummary() {
  if (!canAccessSummary.value) {
    summaryMsg.value = '当前账号无考勤汇总权限'
    return
  }
  currentTab.value = 'summary'
  selectedDepartment.value = null
  selectedUser.value = null
  summaryMode.value = 'day'
  summaryDate.value = new Date().toISOString().slice(0, 10)
  await loadSummary()
}

async function openDepartment(row) {
  selectedDepartment.value = row
  selectedUser.value = null
  await loadSummary()
}

async function openUser(row) {
  selectedUser.value = row
  summaryMode.value = 'month'
  summaryDate.value = new Date().toISOString().slice(0, 10)
  setDefaultCustomRange()
  await loadSummary()
}

async function backSummary() {
  if (summaryLevel.value === 'user') {
    selectedUser.value = null
    await loadSummary()
    return
  }
  if (summaryLevel.value === 'department') {
    selectedDepartment.value = null
    await loadSummary()
  }
}

async function applySummaryFilter() {
  await loadSummary()
}

async function checkFence(loc) {
  const res = await api.post('/checkins/precheck', {
    userId: user.value.userId,
    lat: loc.lat,
    lng: loc.lng
  })
  if (res.data.code !== 'OK') {
    throw new Error(res.data.message || '围栏校验失败')
  }
  precheckMsg.value = `${res.data.data.fenceName}：${res.data.data.message}，偏移 ${res.data.data.distanceMeters}m`
  return res.data.data
}

async function handleCheckin() {
  if (!user.value?.userId) {
    msg.value = '用户信息加载中，请稍后重试'
    return
  }
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
    const res = await api.post('/checkins', payload)
    if (res.data.code === 'OK') {
      msg.value = `${res.data.message}（第${res.data.data.punchIndex}节点，${res.data.data.status}）`
      await refreshAll()
      return
    }
    msg.value = res.data.message || '打卡失败'
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
  console.log('🚀 App onMounted 开始')
  try {
    user.value = await ensureLogin()
    console.log('✅ 用户信息已获取:', user.value)
    setDefaultCustomRange()
    console.log('📡 开始 refreshAll')
    await refreshAll()
    console.log('✅ refreshAll 完成')
    await loadSummaryAccess()
    console.log('✅ loadSummaryAccess 完成')
  } catch (err) {
    console.error('❌ onMounted 错误:', err)
  }
  window.addEventListener('online', syncOfflineQueue)
  nowText.value = new Date().toLocaleString()
  timerId = setInterval(() => {
    nowText.value = new Date().toLocaleString()
  }, 1000)
  console.log('✅ App onMounted 完成')
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
          <h2>{{ currentTab === 'checkin' ? '融媒体中心考勤打卡' : '考勤汇总' }}</h2>
          <p class="sub">{{ nowText }}</p>
        </div>
        <button
          v-if="currentTab === 'checkin'"
          class="btn-ghost"
          :disabled="refreshing"
          @click="refreshAll"
        >{{ refreshing ? '刷新中...' : '刷新数据' }}</button>
        <button v-else class="btn-ghost" @click="currentTab = 'checkin'">返回打卡</button>
      </header>

      <template v-if="currentTab === 'checkin'">
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
          <button
            v-if="canAccessSummary"
            class="btn-entry"
            :disabled="summaryLoading"
            @click="openSummary"
          >考勤汇总入口</button>
        </div>
        <p class="hint" v-if="precheckMsg">{{ precheckMsg }}</p>
        <p class="hint" v-if="syncMsg">{{ syncMsg }}</p>
        <p class="hint" v-if="!canAccessSummary">当前账号无考勤汇总权限</p>
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
      </template>

      <template v-else>
        <div class="panel">
          <div class="summary-head">
            <div class="breadcrumb">
              <button v-if="summaryLevel !== 'organization'" class="link-btn" @click="backSummary">返回</button>
              <span>{{ summaryLevel === 'organization' ? '考勤汇总' : summaryLevel === 'department' ? '部门汇总' : `${summaryData.title || '人员汇总'}` }}</span>
            </div>
            <button class="btn-ghost" @click="calendarOpen = !calendarOpen">{{ calendarOpen ? '收起日历' : '编辑日期' }}</button>
          </div>

          <div v-if="calendarOpen" class="calendar-box">
            <div class="mode-row">
              <button class="pill" :class="{ active: summaryMode === 'day' }" @click="summaryMode = 'day'">日</button>
              <button class="pill" :class="{ active: summaryMode === 'week' }" @click="summaryMode = 'week'">周</button>
              <button class="pill" :class="{ active: summaryMode === 'month' }" @click="summaryMode = 'month'">月</button>
              <button class="pill" :class="{ active: summaryMode === 'custom' }" @click="summaryMode = 'custom'">自定义</button>
            </div>
            <div class="row">
              <template v-if="summaryMode !== 'custom'">
                <input type="date" v-model="summaryDate" />
              </template>
              <template v-else>
                <input type="date" v-model="customStartDate" />
                <span>至</span>
                <input type="date" v-model="customEndDate" />
              </template>
              <button class="btn-second" :disabled="summaryLoading" @click="applySummaryFilter">查询</button>
            </div>
          </div>

          <div class="metrics">
            <div class="metric"><span>应到 / {{ summaryUnit }}</span><strong>{{ summaryData.summary.expected }}</strong></div>
            <div class="metric"><span>实到 / {{ summaryUnit }}</span><strong>{{ summaryData.summary.actual }}</strong></div>
            <div class="metric warning"><span>迟到 / {{ summaryUnit }}</span><strong>{{ summaryData.summary.late }}</strong></div>
            <div class="metric"><span>请假 / {{ summaryUnit }}</span><strong>{{ summaryData.summary.leave }}</strong></div>
          </div>

          <p class="hint" v-if="summaryData.range?.startDate">范围：{{ summaryData.range.startDate }} ~ {{ summaryData.range.endDate }}</p>
          <p class="hint" v-if="summaryLoading">汇总加载中...</p>
          <p class="error-text" v-if="summaryMsg">{{ summaryMsg }}</p>

          <div class="chart-box" v-if="summaryLevel !== 'user' && summaryData.bars.length">
            <div class="chart-grid"></div>
            <div class="chart-list">
              <div class="chart-item" v-for="item in summaryData.bars" :key="item.id">
                <div class="bars">
                  <div class="bar expected" :style="{ height: barHeight(item.expected) }"></div>
                  <div class="bar actual" :style="{ height: barHeight(item.actual) }"></div>
                </div>
                <div class="chart-label">{{ item.name }}</div>
              </div>
            </div>
            <div class="legend">
              <span><i class="dot expected"></i>应到</span>
              <span><i class="dot actual"></i>实到</span>
            </div>
          </div>
        </div>

        <div class="panel" v-if="summaryLevel !== 'user'">
          <ul>
            <li v-for="row in summaryData.rows" :key="row.id" class="click-row" @click="summaryLevel === 'organization' ? openDepartment(row) : openUser(row)">
              <div class="row-main">
                <span>{{ row.name }}</span>
                <span>{{ row.actual }}/{{ row.expected }} <strong class="arrow">›</strong></span>
              </div>
            </li>
          </ul>
        </div>

        <div class="panel" v-else>
          <ul>
            <li v-for="item in summaryData.records" :key="item.id">
              <div class="row-main">
                <span>{{ item.punchedAt }}</span>
                <span>{{ item.punchType }}</span>
                <span class="badge" :class="{ late: item.status === 'LATE' }">{{ item.status === 'NORMAL' ? '正常' : item.status === 'LATE' ? '迟到' : item.status }}</span>
              </div>
            </li>
          </ul>
        </div>
      </template>
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
.btn-second { background: #fff; border: 1px solid #cbd5e1; color: #0f172a; padding: 10px 14px; border-radius: 999px; }
.btn-entry { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; padding: 10px 14px; border-radius: 999px; }
.btn-checkin:disabled, .btn-second:disabled, .btn-entry:disabled, .btn-ghost:disabled { opacity: 0.65; }
.result-msg { margin: 8px 0; padding: 8px 10px; background: #ecfdf3; color: #14532d; border-radius: 6px; border: 1px solid #bbf7d0; }
.hint { margin: 6px 0; color: #334155; font-size: 12px; }
.error { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
.error-text { margin: 6px 0; color: #dc2626; }
.panel { margin-top: 14px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; background: #fff; }
.summary-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.breadcrumb { display: flex; gap: 8px; align-items: center; font-weight: 700; color: #0f172a; }
.link-btn { border: 0; background: transparent; color: #1677ff; padding: 0; }
.calendar-box { border: 1px dashed #cbd5e1; border-radius: 10px; padding: 10px; margin-bottom: 10px; }
.mode-row { display: flex; gap: 8px; margin-bottom: 8px; }
.pill { border: 1px solid #cbd5e1; background: #fff; border-radius: 999px; padding: 6px 10px; color: #334155; }
.pill.active { background: #1677ff; color: #fff; border-color: #1677ff; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
input, button { font-size: 14px; }
input { border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px; }
.chart-box { margin-top: 8px; padding: 8px 0 0; }
.chart-grid { height: 140px; border-left: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; position: relative; }
.chart-list { margin-top: -140px; height: 140px; display: flex; justify-content: space-around; align-items: flex-end; gap: 12px; padding: 0 8px; }
.chart-item { width: 72px; text-align: center; }
.bars { display: flex; justify-content: center; align-items: flex-end; gap: 6px; height: 140px; }
.bar { width: 18px; border-radius: 6px 6px 0 0; }
.bar.expected { background: #3b82f6; }
.bar.actual { background: #22c55e; }
.chart-label { margin-top: 6px; font-size: 12px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.legend { display: flex; gap: 12px; margin-top: 8px; color: #475569; font-size: 12px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.dot.expected { background: #3b82f6; }
.dot.actual { background: #22c55e; }
ul { margin: 0; padding-left: 0; list-style: none; }
li { margin-bottom: 8px; line-height: 1.5; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px; }
li:last-child { margin-bottom: 0; border-bottom: 0; padding-bottom: 0; }
.row-main { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.row-sub { margin-top: 2px; font-size: 12px; color: #64748b; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #e2e8f0; color: #334155; }
.badge.pending { background: #f1f5f9; color: #475569; }
.badge.late { background: #ffedd5; color: #9a3412; }
.click-row { cursor: pointer; }
.arrow { color: #94a3b8; }
.done { color: #14532d; }
.abnormal { color: #b45309; }
</style>
