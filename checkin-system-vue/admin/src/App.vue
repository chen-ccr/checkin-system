<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })
const loginUserId = ref('test123')
const token = ref(localStorage.getItem('admin_token') || '')
const profile = ref(JSON.parse(localStorage.getItem('admin_profile') || 'null'))
const bootstrap = ref({ departments: [], roles: [], geofences: [], shiftRules: [] })
const users = ref([])
const dashboard = ref({ summary: { expected: 0, actual: 0, late: 0, leave: 0, missing: 0 }, abnormalUsers: [], records: [], range: {} })
const query = ref({ mode: 'day', date: '', departmentId: '', userId: '' })
const userForm = ref({ id: '', nickname: '', name: '', phone: '', departmentId: '', roleId: '', isActive: true })
const departmentForm = ref({ name: '' })
const fenceForm = ref({ id: '', name: '', lat: '', lng: '', radius: '', isActive: true })
const ruleForm = ref({ id: '', roleId: '', punchIndex: '', startTime: '', endTime: '', winterStartTime: '', requiredFenceId: '' })
const ruleFilterRoleId = ref('')
const activeTab = ref('dashboard')
const loading = ref(false)
const msg = ref('')
const userModalVisible = ref(false)
const userModalTitle = ref('新增用户')
const ruleModalVisible = ref(false)
const ruleModalTitle = ref('新增班次')

let fenceMap = null
let fenceMarker = null
let geolocation = null
let placeSearch = null
const searchKeyword = ref('')

api.interceptors.request.use((config) => {
  if (token.value) {
    config.headers.Authorization = `Bearer ${token.value}`
  }
  return config
})

const canManageAllDepartment = computed(() => profile.value?.role === 'SUPER_ADMIN')

const filteredShiftRules = computed(() => {
  if (!ruleFilterRoleId.value) return bootstrap.value.shiftRules
  return bootstrap.value.shiftRules.filter(r => String(r.role_id) === ruleFilterRoleId.value)
})

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
  const data = res.data.data
  Object.assign(bootstrap.value, {
    departments: data.departments || [],
    roles: data.roles || [],
    geofences: data.geofences || [],
    shiftRules: data.shiftRules || []
  })
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
  userModalVisible.value = false
  userForm.value = { id: '', nickname: '', name: '', phone: '', departmentId: userForm.value.departmentId || '', roleId: '', isActive: true }
  await loadUsers()
}

function openUserModal(user = null) {
  if (user) {
    userModalTitle.value = '编辑用户'
    userForm.value = {
      id: user.id,
      nickname: user.nickname || '',
      name: user.name,
      phone: user.phone || '',
      departmentId: String(user.department_id),
      roleId: String(user.role_id),
      isActive: Number(user.is_active) === 1
    }
  } else {
    userModalTitle.value = '新增用户'
    userForm.value = { id: '', nickname: '', name: '', phone: '', departmentId: userForm.value.departmentId || '', roleId: '', isActive: true }
  }
  msg.value = ''
  userModalVisible.value = true
}

function editUser(u) {
  openUserModal(u)
}

async function deleteUser(id) {
  if (!confirm('确定删除该用户吗？')) return
  try {
    await api.delete(`/admin/users/${id}`)
    msg.value = '用户删除成功'
    await loadUsers()
  } catch (err) {
    msg.value = err.response?.data?.message || '删除失败'
  }
}

async function importUsers(file) {
  if (!file) return
  msg.value = '导入中...'
  try {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.default.Workbook()
    await workbook.xlsx.load(file)
    const sheet = workbook.getWorksheet(1)
    const rows = []
    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return
      rows.push({
        department: row.getCell(1).value,
        name: row.getCell(2).value,
        phone: String(row.getCell(3).value || '').trim(),
        role: String(row.getCell(4).value || '').trim()
      })
    })
    const valid = rows.filter((r) => r.department && r.name && r.phone)
    if (valid.length === 0) {
      msg.value = '导入失败：未找到有效的部门+姓名+手机号数据'
      return
    }
    let created = 0
    for (const item of valid) {
      let dept = bootstrap.value.departments.find((d) => d.name === item.department)
      if (!dept) {
        await api.post('/admin/departments', { name: item.department })
        await loadBootstrap()
        dept = bootstrap.value.departments.find((d) => d.name === item.department)
      }
      if (!dept) continue
      const phoneExists = users.value.some((u) => u.phone === item.phone)
      if (!phoneExists) {
        const role = bootstrap.value.roles.find((r) => r.name === item.role)
        await api.post('/admin/users', {
          id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: item.name,
          phone: item.phone,
          departmentId: String(dept.id),
          roleId: role ? String(role.id) : String(bootstrap.value.roles[0]?.id || 1),
          isActive: true
        })
        created++
      }
    }
    msg.value = `导入完成：新增 ${created} 个用户`
    await loadUsers()
  } catch (err) {
    msg.value = '导入失败：' + (err.message || '文件格式错误')
  }
}

function handleFileChange(e) {
  const file = e.target.files[0]
  if (file) {
    importUsers(file)
    e.target.value = ''
  }
}

async function saveDepartment() {
  await api.post('/admin/departments', departmentForm.value)
  msg.value = '部门保存成功'
  departmentForm.value = { name: '' }
  await loadBootstrap()
  await loadUsers()
}

async function saveFence() {
  if (!fenceForm.value.name) {
    msg.value = '请输入围栏名称'
    return
  }
  if (!fenceForm.value.lat || !fenceForm.value.lng) {
    msg.value = '请选择或输入经纬度'
    return
  }
  if (!fenceForm.value.radius) {
    msg.value = '请输入半径'
    return
  }

  const isUpdate = !!fenceForm.value.id
  const payload = {
    name: fenceForm.value.name,
    lat: Number(fenceForm.value.lat),
    lng: Number(fenceForm.value.lng),
    radius: Number(fenceForm.value.radius),
    isActive: fenceForm.value.isActive
  }

  if (fenceForm.value.id) {
    payload.id = fenceForm.value.id
  }

  try {
    await api.post('/admin/geofences', payload)
    msg.value = isUpdate ? '围栏更新成功' : '围栏新增成功'
    await loadBootstrap()
    clearFenceForm()
  } catch (err) {
    msg.value = err.response?.data?.message || '保存失败'
  }
}

function editFence(fence) {
  fenceForm.value = {
    id: fence.id,
    name: fence.name,
    lat: String(fence.lat),
    lng: String(fence.lng),
    radius: String(fence.radius),
    isActive: Number(fence.is_active) === 1
  }
  updateFenceMap()
  msg.value = ''
}

async function deleteFence(id) {
  if (!confirm(`确定删除围栏 ID=${id} 吗？`)) return
  await api.delete(`/admin/geofences/${id}`)
  msg.value = '围栏删除成功'
  if (fenceForm.value.id === id) {
    clearFenceForm()
  }
  await loadBootstrap()
}

function clearFenceForm() {
  fenceForm.value = { id: '', name: '', lat: '', lng: '', radius: '', isActive: true }
  if (fenceMarker) {
    fenceMap?.remove(fenceMarker)
    fenceMarker = null
  }
  msg.value = ''
}

const mapLoading = ref(false)
const mapError = ref('')

function initFenceMap() {
  let attempts = 0
  const maxAttempts = 30

  function tryInit() {
    attempts++
    const mapContainer = document.getElementById('fence-map')
    if (!mapContainer) {
      if (attempts < maxAttempts) {
        setTimeout(tryInit, 300)
      } else {
        mapLoading.value = false
        mapError.value = '地图容器未找到'
      }
      return
    }

    if (window.AMap && mapContainer.offsetWidth > 0 && mapContainer.offsetHeight > 0) {
      if (fenceMap) {
        fenceMap.destroy()
        fenceMap = null
      }
      
      mapContainer.innerHTML = ''
      mapLoading.value = true
      mapError.value = ''
      
      fenceMap = new AMap.Map('fence-map', {
        zoom: 15,
        center: [115.89925, 28.68503],
        resizeEnable: true
      })

      fenceMap.on('click', (e) => {
        const lng = e.lnglat.getLng()
        const lat = e.lnglat.getLat()
        fenceForm.value.lat = lat.toFixed(6)
        fenceForm.value.lng = lng.toFixed(6)
        updateFenceMap()
      })

      AMap.plugin(['AMap.Geolocation', 'AMap.CitySearch'], () => {
        geolocation = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 10000,
          showButton: true,
          showMarker: true,
          showCircle: true,
          panToLocation: true,
          zoomToAccuracy: true
        })
        fenceMap.addControl(geolocation)
        
        geolocation.getCurrentPosition((status, result) => {
          mapLoading.value = false
          if (status === 'complete') {
            const lat = result.position.lat
            const lng = result.position.lng
            fenceMap.setCenter([lng, lat])
            mapError.value = ''
          } else {
            const citySearch = new AMap.CitySearch()
            citySearch.getLocalCity((status, result) => {
              mapLoading.value = false
              if (status === 'complete' && result.info === 'OK') {
                fenceMap.setCenter(result.city.center)
                mapError.value = '精确定位失败，已定位到所在城市'
              } else {
                mapError.value = '定位失败，请手动选择位置或搜索'
              }
            })
          }
        })
      })

      AMap.plugin('AMap.PlaceSearch', () => {
        placeSearch = new AMap.PlaceSearch({
          pageSize: 10,
          pageIndex: 1,
          extensions: 'all',
          city: '全国'
        })
      })

      updateFenceMap()
      mapLoading.value = false
    } else if (attempts < maxAttempts) {
      setTimeout(tryInit, 300)
    } else {
      mapLoading.value = false
      mapError.value = '地图加载超时，请刷新页面重试'
    }
  }

  if (fenceMap) {
    fenceMap.destroy()
    fenceMap = null
  }
  setTimeout(tryInit, 300)
}

function searchPlace() {
  if (!searchKeyword.value) {
    msg.value = '请输入搜索关键词'
    return
  }
  if (!fenceMap) {
    msg.value = '地图尚未加载完成'
    return
  }
  
  if (!placeSearch) {
    AMap.plugin('AMap.PlaceSearch', () => {
      placeSearch = new AMap.PlaceSearch({
        pageSize: 10,
        pageIndex: 1,
        extensions: 'all',
        city: '全国'
      })
      doSearch()
    })
  } else {
    doSearch()
  }
}

function doSearch() {
  if (!placeSearch) {
    msg.value = '搜索服务未就绪，请稍后重试'
    return
  }
  msg.value = '搜索中...'
  placeSearch.search(searchKeyword.value, (status, result) => {
    msg.value = ''
    if (status === 'complete' && result.poiList && result.poiList.pois.length > 0) {
      const firstPoi = result.poiList.pois[0]
      const lng = firstPoi.location.lng
      const lat = firstPoi.location.lat
      fenceForm.value.lat = lat.toFixed(6)
      fenceForm.value.lng = lng.toFixed(6)
      updateFenceMap()
      setTimeout(() => {
        if (fenceMap) {
          fenceMap.setCenter([lng, lat])
          fenceMap.setZoom(16)
        }
      }, 100)
      msg.value = `已定位到: ${firstPoi.name}`
    } else {
      msg.value = '未找到相关位置，请尝试其他关键词'
    }
  })
}

function updateFenceMap() {
  if (!fenceMap) return

  if (fenceMarker) {
    fenceMap.remove(fenceMarker)
    fenceMarker = null
  }

  if (fenceForm.value.lat && fenceForm.value.lng) {
    fenceMarker = new AMap.Marker({
      position: [Number(fenceForm.value.lng), Number(fenceForm.value.lat)]
    })
    fenceMap.add(fenceMarker)
    fenceMap.setCenter([Number(fenceForm.value.lng), Number(fenceForm.value.lat)])
  }
}

async function saveShiftRule() {
  await api.post('/admin/shift-rules', ruleForm.value)
  msg.value = '班次规则保存成功'
  ruleForm.value = { id: '', roleId: '', punchIndex: '', startTime: '', endTime: '', winterStartTime: '', requiredFenceId: '' }
  await loadBootstrap()
}

function openRuleModal(rule = null) {
  if (rule) {
    ruleModalTitle.value = '编辑班次'
    ruleForm.value = {
      id: rule.id,
      roleId: String(rule.role_id),
      punchIndex: String(rule.punch_index),
      startTime: rule.start_time,
      endTime: rule.end_time,
      winterStartTime: rule.winter_start_time || '',
      requiredFenceId: rule.required_fence_id ? String(rule.required_fence_id) : ''
    }
  } else {
    ruleModalTitle.value = '新增班次'
    ruleForm.value = { id: '', roleId: '', punchIndex: '', startTime: '', endTime: '', winterStartTime: '', requiredFenceId: '' }
  }
  msg.value = ''
  ruleModalVisible.value = true
}

function editShiftRule(r) {
  openRuleModal(r)
}

async function deleteShiftRule(id) {
  if (!confirm('确定删除该班次规则吗？')) return
  try {
    await api.delete(`/admin/shift-rules/${id}`)
    msg.value = '班次规则删除成功'
    await loadBootstrap()
  } catch (err) {
    msg.value = err.response?.data?.message || '删除失败'
  }
}

function clearRuleForm() {
  openRuleModal(null)
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

watch(activeTab, (newTab) => {
  if (newTab === 'fences') {
    setTimeout(initFenceMap, 100)
  }
})
</script>

<template>
  <div class="login-page">
    <div class="bg-animation">
      <div class="grid-lines"></div>
      <div class="glow-orb orb1"></div>
      <div class="glow-orb orb2"></div>
    </div>

    <div v-if="!token" class="login-container">
      <div class="login-card">
        <div class="login-header">
          <div class="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          </div>
          <h1>考勤管理系统</h1>
          <p class="subtitle">智能打卡 · 高效管理</p>
        </div>

        <div class="login-body">
          <div class="input-group">
            <div class="input-wrapper">
              <span class="input-icon">👤</span>
              <input v-model="loginUserId" placeholder="请输入用户ID" @keyup.enter="login" />
            </div>
          </div>

          <button class="login-btn" :disabled="loading" @click="login">
            <span v-if="loading" class="loading-spinner"></span>
            <span v-else>登 录</span>
          </button>

          <p class="error-msg" v-if="msg">{{ msg }}</p>
        </div>

        <div class="login-footer">
          <span class="version">v2.0</span>
        </div>
      </div>
    </div>

    <div v-else>
      <div class="toolbar">
        <span>当前账号：{{ profile?.userName }}（{{ profile?.role }}）</span>
        <button @click="logout">退出</button>
      </div>
      <div class="tabs">
        <button :class="{ active: activeTab === 'dashboard' }" @click="activeTab = 'dashboard'">汇总看板</button>
        <button :class="{ active: activeTab === 'departments' }" @click="activeTab = 'departments'">部门管理</button>
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

      <div class="card" v-if="activeTab === 'departments'">
        <h3>部门管理</h3>
        <div class="row">
          <input v-model="departmentForm.name" placeholder="部门名称" />
          <button @click="saveDepartment">新增部门</button>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>部门名称</th></tr>
          </thead>
          <tbody>
            <tr v-for="d in bootstrap.departments" :key="d.id">
              <td>{{ d.id }}</td>
              <td>{{ d.name }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" v-if="activeTab === 'users'">
        <h3>人员与角色配置</h3>
        <div class="row">
          <label>部门筛选</label>
          <select v-model="query.departmentId">
            <option value="">全部</option>
            <option v-for="d in bootstrap.departments" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
          </select>
          <button @click="loadUsers">筛选</button>
          <button @click="openUserModal()" style="background: #1677ff; color: white; margin-left: 8px;">新增用户</button>
          <label style="margin-left: 12px;">导入Excel</label>
          <input type="file" accept=".xlsx,.xls" @change="handleFileChange" style="padding: 6px;" />
        </div>
        <p style="font-size: 12px; color: #666; margin: 4px 0;">💡 Excel导入格式：第1列=部门，第2列=姓名，第3列=手机号，第4列=角色</p>
        <table>
          <thead>
            <tr><th>昵称</th><th>姓名</th><th>手机号</th><th>部门</th><th>角色</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>{{ u.nickname || '-' }}</td>
              <td>{{ u.name }}</td>
              <td>{{ u.phone || '-' }}</td>
              <td>{{ u.department_name }}</td>
              <td>{{ u.role_name }}</td>
              <td>{{ Number(u.is_active) === 1 ? '启用' : '停用' }}</td>
              <td>
                <button @click="editUser(u)" style="padding: 4px 8px; font-size: 12px;">编辑</button>
                <button @click="deleteUser(u.id)" style="padding: 4px 8px; font-size: 12px; background: #ef4444; color: white; margin-left: 4px;">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" v-if="activeTab === 'fences'">
        <h3>围栏配置</h3>
        <div class="row">
          <input v-model="searchKeyword" placeholder="搜索地点（如：南昌市政府）" style="flex: 1" @keyup.enter="searchPlace" />
          <button @click="searchPlace" style="background: #1677ff; color: white;">搜索</button>
        </div>
        <div class="row">
          <input v-model="fenceForm.name" placeholder="围栏名称" style="flex: 1" />
          <input v-model="fenceForm.lat" placeholder="纬度" style="width: 100px" />
          <input v-model="fenceForm.lng" placeholder="经度" style="width: 100px" />
          <input v-model="fenceForm.radius" placeholder="半径（米）" style="width: 80px" />
          <label><input type="checkbox" v-model="fenceForm.isActive" /> 启用</label>
          <button @click="saveFence">{{ fenceForm.id ? '更新' : '新增' }}</button>
          <button @click="clearFenceForm" style="background: #f0f0f0">清空</button>
        </div>
        <p style="font-size: 12px; color: #666; margin: 8px 0;">💡 搜索地点或点击地图选择位置，地图会自动定位到您的当前位置</p>
        <div id="fence-map" style="height: 300px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 12px; position: relative;">
          <div v-if="mapLoading" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #666;">
            地图加载中...
          </div>
        </div>
        <p v-if="mapError" style="font-size: 12px; color: #dc2626; margin: 4px 0;">{{ mapError }}</p>
        <table>
          <thead>
            <tr><th>ID</th><th>名称</th><th>坐标</th><th>半径</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="f in bootstrap.geofences" :key="f.id">
              <td>{{ f.id }}</td>
              <td>{{ f.name }}</td>
              <td>{{ f.lat }}, {{ f.lng }}</td>
              <td>{{ f.radius }}m</td>
              <td>{{ Number(f.is_active) === 1 ? '启用' : '停用' }}</td>
              <td>
                <button @click="editFence(f)" style="margin-right: 4px; padding: 4px 8px; font-size: 12px;">编辑</button>
                <button @click="deleteFence(f.id)" style="background: #fee; color: #c00; padding: 4px 8px; font-size: 12px;">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" v-if="activeTab === 'rules'">
        <h3>班次规则配置</h3>
        <div class="row">
          <select v-model="ruleFilterRoleId">
            <option value="">全部角色</option>
            <option v-for="r in bootstrap.roles" :key="r.id" :value="String(r.id)">{{ r.name }}</option>
          </select>
          <button @click="openRuleModal()" style="background: #1677ff; color: white; margin-left: 8px;">新增班次</button>
        </div>
        <table>
          <thead>
            <tr><th>角色</th><th>节点</th><th>时段</th><th>冬季起始</th><th>指定围栏</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in filteredShiftRules" :key="r.id">
              <td>{{ r.role_name }}</td>
              <td>{{ r.punch_index }}</td>
              <td>{{ r.start_time }} - {{ r.end_time }}</td>
              <td>{{ r.winter_start_time || '-' }}</td>
              <td>{{ r.fence_name || '-' }}</td>
              <td>
                <button @click="editShiftRule(r)" style="padding: 4px 8px; font-size: 12px;">编辑</button>
                <button @click="deleteShiftRule(r.id)" style="padding: 4px 8px; font-size: 12px; background: #ef4444; color: white; margin-left: 4px;">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="userModalVisible" class="modal-overlay" @click.self="userModalVisible = false">
        <div class="modal">
          <h3>{{ userModalTitle }}</h3>
          <div class="modal-body">
            <div class="form-row">
              <label>用户ID</label>
              <input v-model="userForm.id" placeholder="用户ID" :disabled="!!userForm.id" />
            </div>
            <div class="form-row">
              <label>昵称</label>
              <input v-model="userForm.nickname" placeholder="昵称（优先显示）" />
            </div>
            <div class="form-row">
              <label>姓名</label>
              <input v-model="userForm.name" placeholder="姓名" />
            </div>
            <div class="form-row">
              <label>手机号</label>
              <input v-model="userForm.phone" placeholder="手机号" />
            </div>
            <div class="form-row">
              <label>部门</label>
              <select v-model="userForm.departmentId">
                <option value="" disabled>选择部门</option>
                <option v-for="d in bootstrap.departments" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
              </select>
            </div>
            <div class="form-row">
              <label>角色</label>
              <select v-model="userForm.roleId">
                <option value="" disabled>选择角色</option>
                <option v-for="r in bootstrap.roles" :key="r.id" :value="String(r.id)">{{ r.name }}</option>
              </select>
            </div>
            <div class="form-row">
              <label><input type="checkbox" v-model="userForm.isActive" /> 启用</label>
            </div>
          </div>
          <div class="modal-footer">
            <button @click="saveUser" style="background: #1677ff; color: white;">保存</button>
            <button @click="userModalVisible = false" style="background: #f0f0f0;">取消</button>
          </div>
        </div>
      </div>

      <div v-if="ruleModalVisible" class="modal-overlay" @click.self="ruleModalVisible = false">
        <div class="modal">
          <h3>{{ ruleModalTitle }}</h3>
          <div class="modal-body">
            <div class="form-row">
              <label>角色</label>
              <select v-model="ruleForm.roleId">
                <option value="" disabled>选择角色</option>
                <option v-for="r in bootstrap.roles" :key="r.id" :value="String(r.id)">{{ r.name }}</option>
              </select>
            </div>
            <div class="form-row">
              <label>节点</label>
              <input v-model="ruleForm.punchIndex" placeholder="节点（如 1）" type="number" />
            </div>
            <div class="form-row">
              <label>开始时间</label>
              <input v-model="ruleForm.startTime" placeholder="如 09:00" />
            </div>
            <div class="form-row">
              <label>结束时间</label>
              <input v-model="ruleForm.endTime" placeholder="如 18:00" />
            </div>
            <div class="form-row">
              <label>冬季起始时间</label>
              <input v-model="ruleForm.winterStartTime" placeholder="如 09:30（可选）" />
            </div>
            <div class="form-row">
              <label>指定围栏</label>
              <select v-model="ruleForm.requiredFenceId">
                <option value="">不指定</option>
                <option v-for="f in bootstrap.geofences" :key="f.id" :value="String(f.id)">{{ f.name }}</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button @click="saveShiftRule" style="background: #1677ff; color: white;">保存</button>
            <button @click="ruleModalVisible = false" style="background: #f0f0f0;">取消</button>
          </div>
        </div>
      </div>

      <p v-if="msg">{{ msg }}</p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0e27;
  position: relative;
  overflow: hidden;
}

.bg-animation {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.grid-lines {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image:
    linear-gradient(rgba(22, 119, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(22, 119, 255, 0.03) 1px, transparent 1px);
  background-size: 50px 50px;
  animation: gridMove 20s linear infinite;
}

@keyframes gridMove {
  0% { transform: translateY(0); }
  100% { transform: translateY(50px); }
}

.glow-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.4;
  animation: float 8s ease-in-out infinite;
}

.orb1 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, #1677ff 0%, transparent 70%);
  top: -100px;
  right: -100px;
}

.orb2 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, #00d4ff 0%, transparent 70%);
  bottom: -50px;
  left: -50px;
  animation-delay: -4s;
}

@keyframes float {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-30px) scale(1.05); }
}

.login-container {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 420px;
  padding: 20px;
}

.login-card {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 48px 40px;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.login-header {
  text-align: center;
  margin-bottom: 40px;
}

.logo-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 20px;
  background: linear-gradient(135deg, #1677ff 0%, #00d4ff 100%);
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 32px rgba(22, 119, 255, 0.3);
}

.logo-icon svg {
  width: 36px;
  height: 36px;
  color: white;
}

.login-header h1 {
  font-size: 28px;
  font-weight: 600;
  color: #fff;
  margin: 0 0 8px 0;
  letter-spacing: 2px;
}

.login-header .subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
  margin: 0;
  letter-spacing: 4px;
}

.login-body {
  margin-bottom: 32px;
}

.input-group {
  margin-bottom: 24px;
}

.input-wrapper {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 0 16px;
  transition: all 0.3s ease;
}

.input-wrapper:focus-within {
  border-color: #1677ff;
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.2);
}

.input-icon {
  font-size: 18px;
  margin-right: 12px;
}

.input-wrapper input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 16px 0;
  font-size: 16px;
  color: #fff;
}

.input-wrapper input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.login-btn {
  width: 100%;
  padding: 16px;
  background: linear-gradient(135deg, #1677ff 0%, #00d4ff 100%);
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  color: white;
  cursor: pointer;
  letter-spacing: 4px;
  transition: all 0.3s ease;
  box-shadow: 0 8px 32px rgba(22, 119, 255, 0.3);
}

.login-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(22, 119, 255, 0.4);
}

.login-btn:active:not(:disabled) {
  transform: translateY(0);
}

.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-msg {
  text-align: center;
  color: #ff6b6b;
  font-size: 14px;
  margin-top: 16px;
}

.login-footer {
  text-align: center;
}

.version {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
  letter-spacing: 2px;
}

.page { width: 100%; min-height: 100vh; margin: 0 auto; padding: 20px; font-family: sans-serif; background: #f5f7fa; }
.card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 16px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.toolbar { display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center; }
.tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.tabs button { padding: 8px 12px; }
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
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: white; border-radius: 12px; padding: 20px; width: 400px; max-width: 90%; }
.modal h3 { margin: 0 0 16px 0; font-size: 18px; }
.modal-body { margin-bottom: 16px; }
.form-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.form-row label { width: 90px; text-align: right; }
.form-row input, .form-row select { flex: 1; }
.modal-footer { display: flex; gap: 8px; justify-content: flex-end; }

@media (max-width: 768px) {
  .metrics { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .card { padding: 12px; }
  .page { padding: 12px; }
  table { font-size: 12px; }
  th, td { padding: 6px 4px; }
}

@media (min-width: 1024px) {
  .page { max-width: 1400px; padding: 24px 40px; }
  .card { padding: 24px 32px; }
  .tabs { gap: 12px; }
  .tabs button { padding: 10px 20px; font-size: 15px; }
  th, td { padding: 12px 16px; font-size: 14px; }
  .metrics { gap: 16px; }
  .metric { padding: 16px; }
}
</style>
