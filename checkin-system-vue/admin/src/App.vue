<script setup>
import { ref, computed } from 'vue'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })
const loginUserId = ref('test123')
const token = ref(localStorage.getItem('admin_token') || '')
const profile = ref(JSON.parse(localStorage.getItem('admin_profile') || 'null'))
const bootstrap = ref({ departments: [], roles: [], geofences: [], shiftRules: [] })
const users = ref([])
const dashboard = ref({ summary: { expected: 0, actual: 0, late: 0, leave: 0, missing: 0 }, abnormalUsers: [], records: [], range: {} })
const query = ref({ mode: 'day', date: '', departmentId: '', userId: '' })
const userForm = ref({ id: '', name: '', departmentId: '', roleId: '', isActive: true })
const fenceForm = ref({ id: '', name: '', lat: '', lng: '', radius: '', isActive: true })
const ruleForm = ref({ roleId: '', punchIndex: '', startTime: '', endTime: '', winterStartTime: '', requiredFenceId: '' })
const activeTab = ref('dashboard')
const loading = ref(false)
const msg = ref('')

api.interceptors.request.use((config) => {
  if (token.value) {
    config.headers.Authorization = `Bearer ${token.value}`
  }
  return config
})

const canManageAllDepartment = computed(() => profile.value?.role === 'SUPER_ADMIN')

async function login() {
  loading.value = true
  msg.value = ''
  try {
    const res = await api.post('/auth/login', { userId: loginUserId.value })
    token.value = res.data.data.token
    profile.value = res.data.data.profile
    localStorage.setItem('admin_token', token.value)
    localStorage.setItem('admin_profile', JSON.stringify(profile.value))
    await loadBootstrap()
    await loadUsers()
    await loadDashboard()
  } catch (error) {
    msg.value = error.response?.data?.message || '登录失败'
  } finally {
    loading.value = false
  }
}

function logout() {
  token.value = ''
  profile.value = null
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_profile')
}

async function loadBootstrap() {
  const res = await api.get('/admin/bootstrap')
  bootstrap.value = res.data.data
  if (!query.value.date) {
    query.value.date = new Date().toISOString().slice(0, 10)
  }
  if (!query.value.departmentId && !canManageAllDepartment.value) {
    query.value.departmentId = String(profile.value.departmentId)
  }
  if (!userForm.value.departmentId) {
    userForm.value.departmentId = query.value.departmentId || String(bootstrap.value.departments[0]?.id || '')
  }
}

async function loadUsers() {
  const params = {}
  if (query.value.departmentId) params.departmentId = query.value.departmentId
  const res = await api.get('/admin/users', { params })
  users.value = res.data.data
}

async function saveUser() {
  await api.post('/admin/users', userForm.value)
  msg.value = '用户保存成功'
  userForm.value = { id: '', name: '', departmentId: userForm.value.departmentId || '', roleId: '', isActive: true }
  await loadUsers()
}

async function saveFence() {
  await api.post('/admin/geofences', fenceForm.value)
  msg.value = '围栏保存成功'
  fenceForm.value = { id: '', name: '', lat: '', lng: '', radius: '', isActive: true }
  await loadBootstrap()
}

async function saveShiftRule() {
  await api.post('/admin/shift-rules', ruleForm.value)
  msg.value = '班次规则保存成功'
  ruleForm.value = { roleId: '', punchIndex: '', startTime: '', endTime: '', winterStartTime: '', requiredFenceId: '' }
  await loadBootstrap()
}

async function loadDashboard() {
  const params = {
    mode: query.value.mode,
    date: query.value.date || undefined,
    departmentId: query.value.departmentId || undefined,
    userId: query.value.userId || undefined
  }
  const res = await api.get('/admin/dashboard', { params })
  dashboard.value = res.data.data
}

async function exportXlsx() {
  const response = await api.get('/admin/export', {
    params: {
      mode: query.value.mode,
      date: query.value.date || undefined,
      departmentId: query.value.departmentId || undefined,
      userId: query.value.userId || undefined
    },
    responseType: 'blob'
  })
  const disposition = response.headers['content-disposition'] || ''
  const matched = disposition.match(/filename="([^"]+)"/)
  const fileName = matched?.[1] || `attendance-${query.value.mode || 'day'}.xlsx`
  const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const downloadUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(downloadUrl)
}

if (token.value) {
  Promise.all([loadBootstrap(), loadUsers(), loadDashboard()]).catch(() => {
    logout()
  })
}
</script>

<template>
  <div class="page">
    <h2>考勤管理后台</h2>

    <div v-if="!token" class="card">
      <h3>登录</h3>
      <input v-model="loginUserId" placeholder="输入用户ID，例如 test123" />
      <button :disabled="loading" @click="login">{{ loading ? '登录中...' : '登录' }}</button>
      <p class="error" v-if="msg">{{ msg }}</p>
    </div>

    <div v-else>
      <div class="toolbar">
        <span>当前账号：{{ profile?.userName }}（{{ profile?.role }}）</span>
        <button @click="logout">退出</button>
      </div>
      <div class="tabs">
        <button :class="{ active: activeTab === 'dashboard' }" @click="activeTab = 'dashboard'">汇总看板</button>
        <button :class="{ active: activeTab === 'users' }" @click="activeTab = 'users'">人员管理</button>
        <button :class="{ active: activeTab === 'fences' }" @click="activeTab = 'fences'">围栏管理</button>
        <button :class="{ active: activeTab === 'rules' }" @click="activeTab = 'rules'">班次规则</button>
      </div>

      <div class="card" v-if="activeTab === 'dashboard'">
        <h3>统计与导出</h3>
        <div class="row">
          <label>维度</label>
          <select v-model="query.mode">
            <option value="day">日</option>
            <option value="week">周</option>
            <option value="month">月</option>
          </select>
          <label>日期</label>
          <input type="date" v-model="query.date" />
          <label>部门</label>
          <select v-model="query.departmentId">
            <option value="">全部</option>
            <option v-for="d in bootstrap.departments" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
          </select>
          <button @click="loadDashboard">查询</button>
          <button @click="exportXlsx">导出</button>
        </div>

        <div class="metrics">
          <div class="metric">应到 {{ dashboard.summary.expected }}</div>
          <div class="metric">实到 {{ dashboard.summary.actual }}</div>
          <div class="metric warn">迟到 {{ dashboard.summary.late }}</div>
          <div class="metric">请假 {{ dashboard.summary.leave }}</div>
          <div class="metric danger">缺卡 {{ dashboard.summary.missing }}</div>
        </div>

        <h4>异常名单</h4>
        <table>
          <thead>
            <tr><th>人员</th><th>部门</th><th>迟到次数</th><th>离线次数</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in dashboard.abnormalUsers" :key="item.userId">
              <td>{{ item.userName }}</td>
              <td>{{ item.departmentName }}</td>
              <td>{{ item.lateCount }}</td>
              <td>{{ item.offlineCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" v-if="activeTab === 'users'">
        <h3>人员与角色配置</h3>
        <div class="row">
          <input v-model="userForm.id" placeholder="用户ID" />
          <input v-model="userForm.name" placeholder="姓名" />
          <select v-model="userForm.departmentId">
            <option value="" disabled>选择部门</option>
            <option v-for="d in bootstrap.departments" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
          </select>
          <select v-model="userForm.roleId">
            <option value="" disabled>选择角色</option>
            <option v-for="r in bootstrap.roles" :key="r.id" :value="String(r.id)">{{ r.name }}</option>
          </select>
          <label><input type="checkbox" v-model="userForm.isActive" /> 启用</label>
          <button @click="saveUser">保存</button>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>姓名</th><th>部门</th><th>角色</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>{{ u.id }}</td>
              <td>{{ u.name }}</td>
              <td>{{ u.department_name }}</td>
              <td>{{ u.role_name }}</td>
              <td>{{ Number(u.is_active) === 1 ? '启用' : '停用' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" v-if="activeTab === 'fences'">
        <h3>围栏配置</h3>
        <div class="row">
          <input v-model="fenceForm.id" placeholder="围栏ID（留空为新增）" />
          <input v-model="fenceForm.name" placeholder="围栏名称" />
          <input v-model="fenceForm.lat" placeholder="纬度" />
          <input v-model="fenceForm.lng" placeholder="经度" />
          <input v-model="fenceForm.radius" placeholder="半径（米）" />
          <label><input type="checkbox" v-model="fenceForm.isActive" /> 启用</label>
          <button @click="saveFence">保存</button>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>名称</th><th>坐标</th><th>半径</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr v-for="f in bootstrap.geofences" :key="f.id">
              <td>{{ f.id }}</td>
              <td>{{ f.name }}</td>
              <td>{{ f.lat }}, {{ f.lng }}</td>
              <td>{{ f.radius }}m</td>
              <td>{{ Number(f.is_active) === 1 ? '启用' : '停用' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" v-if="activeTab === 'rules'">
        <h3>班次规则配置</h3>
        <div class="row">
          <select v-model="ruleForm.roleId">
            <option value="" disabled>选择角色</option>
            <option v-for="r in bootstrap.roles" :key="r.id" :value="String(r.id)">{{ r.name }}</option>
          </select>
          <input v-model="ruleForm.punchIndex" placeholder="节点序号" />
          <input v-model="ruleForm.startTime" placeholder="开始时间 08:00:00" />
          <input v-model="ruleForm.endTime" placeholder="结束时间 08:30:00" />
          <input v-model="ruleForm.winterStartTime" placeholder="冬季开始时间（可空）" />
          <select v-model="ruleForm.requiredFenceId">
            <option value="">默认围栏</option>
            <option v-for="f in bootstrap.geofences" :key="f.id" :value="String(f.id)">{{ f.name }}</option>
          </select>
          <button @click="saveShiftRule">保存</button>
        </div>
        <table>
          <thead>
            <tr><th>角色</th><th>节点</th><th>时段</th><th>冬季起始</th><th>指定围栏</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in bootstrap.shiftRules" :key="r.id">
              <td>{{ r.role_name }}</td>
              <td>{{ r.punch_index }}</td>
              <td>{{ r.start_time }} - {{ r.end_time }}</td>
              <td>{{ r.winter_start_time || '-' }}</td>
              <td>{{ r.fence_name || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="msg">{{ msg }}</p>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 1200px; margin: 0 auto; padding: 20px; font-family: sans-serif; }
.card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 16px; background: #fff; }
.toolbar { display: flex; justify-content: space-between; margin-bottom: 12px; }
.tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.tabs button.active { background: #1677ff; color: #fff; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
input, select, button { padding: 8px 10px; border-radius: 6px; border: 1px solid #d1d5db; }
button { cursor: pointer; background: #f9fafb; }
table { width: 100%; border-collapse: collapse; background: #fff; }
th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 13px; }
.metrics { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 8px; margin-bottom: 12px; }
.metric { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; text-align: center; background: #f9fafb; }
.warn { color: #d97706; }
.danger { color: #dc2626; }
.error { color: #dc2626; }
</style>
