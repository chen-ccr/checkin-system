<script setup>
import { ref } from 'vue'

const user = ref(null)
const location = ref(null)
const msg = ref('')

// ✅ 获取用户信息（带降级）
const getUser = async () => {
  if (window.CP2) {
    const res = await window.CP2.getUserInfo()
    user.value = res
  } else {
    // 👉 浏览器调试用
    user.value = {
      userId: 'test001',
      name: '本地测试用户'
    }
  }
}

// ✅ 获取定位
const getLocation = async () => {
  if (window.CP2) {
    const res = await window.CP2.getLocation()
    return res
  } else {
    return {
      lat: 28.123,
      lng: 115.123
    }
  }
}

// ✅ 打卡
const checkin = async () => {
  const loc = await getLocation()

  const res = await fetch('http://localhost:3001/checkin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId: user.value.userId,
      lat: loc.lat,
      lng: loc.lng
    })
  })

  const data = await res.json()
  msg.value = data.msg
}

getUser()
</script>

<template>
  <div>
    <h3>考勤打卡</h3>

    <p>用户：{{ user }}</p>

    <button @click="checkin">打卡</button>

    <p>{{ msg }}</p>
  </div>
</template>