<template>
  <div>
    <h2>考勤打卡</h2>
    <button @click="handleCheckin">打卡</button>
    <p>{{ msg }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ensureLogin } from '../utils/auth'
import { getLocation } from '../utils/location'
import axios from 'axios'

const msg = ref('')

async function handleCheckin() {
  const user = await ensureLogin()
  const loc = await getLocation()
  const headers = {}
  if (user.sessionId) headers.Authorization = `Bearer ${user.sessionId}`
  if (user.signature) headers['X-CP2-Signature'] = user.signature
  if (user.timestamp) headers['X-CP2-Timestamp'] = user.timestamp

  const res = await axios.post('/api/v1/checkin', {
    userId: user.userId,
    lat: loc.lat,
    lng: loc.lng
  }, {
    headers
  })

  msg.value = res.data.message
}
</script>
