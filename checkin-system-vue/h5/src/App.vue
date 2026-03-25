<script setup>
import { ref, onMounted } from 'vue'

const user = ref(null)
const msg = ref('')
const loading = ref(false)

const API_BASE = 'http://localhost:3001/api'

// ✅ 获取用户信息（带 roleId 模拟）
const getUser = async () => {
  if (window.CP2 && window.CP2.getUserInfo) {
    user.value = await window.CP2.getUserInfo().data.user
  } else {
    // 模拟不同角色进行测试：1-行政, 8-导播
    user.value = {
      id: 'user_001',
      nick_name: '测试员',
      roleId: 1 
    }
  }
}

// ✅ 获取定位（调用硬件/原生能力）
const getLocation = async () => {
  if (window.CP2 && window.CP2.getLocation) {
    return await window.CP2.getLocation()
  } else {
    // 模拟坐标：融媒体中心附近
    return { lat: 26.5668, lng: 107.5173 }
  }
}

// ✅ 执行打卡
const handleCheckin = async () => {
  if (loading.value) return
  loading.value = true
  msg.value = '正在定位并提交...'

  try {
    const loc = await getLocation()
    
    const res = await fetch(`${API_BASE}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.value.userId,
        roleId: user.value.roleId,
        lat: loc.lat,
        lng: loc.lng
      })
    })

    const data = await res.json()
    // 后端返回的是 { message, locationName, status }
    msg.value = data.message || (data.success ? '打卡成功' : '打卡失败')
    
  } catch (error) {
    console.error('打卡异常:', error)
    msg.value = '网络错误，请检查服务器连接'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  getUser()
})
</script>

<template>
  <div class="checkin-container">
    <h2>融媒体中心考勤系统</h2>
    
    <div v-if="user" class="user-card">
      <p><strong>姓名：</strong>{{ user.nick_name }}</p>
      <p><strong>工号：</strong>{{ user.id }}</p>
      <p><strong>角色 ID：</strong>{{ user.roleId }}</p>
    </div>

    <div class="action-section">
      <button @click="handleCheckin" :disabled="loading" class="btn-checkin">
        {{ loading ? '处理中...' : '立即打卡' }}
      </button>
    </div>

    <transition name="fade">
      <div v-if="msg" class="result-msg" :class="{ 'error': msg.includes('失败') || msg.includes('错误') }">
        {{ msg }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.checkin-container { padding: 20px; text-align: center; font-family: sans-serif; }
.user-card { background: #f4f4f4; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: left; }
.btn-checkin { 
  background: #4CAF50; color: white; border: none; padding: 15px 40px; 
  font-size: 18px; border-radius: 30px; cursor: pointer; transition: 0.3s;
}
.btn-checkin:disabled { background: #ccc; }
.result-msg { margin-top: 20px; padding: 10px; color: #2c3e50; font-weight: bold; }
.error { color: #e74c3c; }
</style>