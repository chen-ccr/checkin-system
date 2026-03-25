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

  const res = await axios.post('/api/checkin', {
    userId: user.accountId,
    lat: loc.lat,
    lng: loc.lng
  })

  msg.value = res.data.message
}
</script>