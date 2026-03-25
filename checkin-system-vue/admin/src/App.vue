<template>
  <div style="padding:20px">
    <h2>后台管理</h2>

    <h3>新增用户</h3>
    <input v-model="name" placeholder="姓名" />
    <button @click="addUser">添加</button>

    <h3>用户列表</h3>
    <ul>
      <li v-for="u in users" :key="u.id">
        {{ u.name }}
      </li>
    </ul>

    <h3>打卡记录</h3>
    <ul>
      <li v-for="r in records" :key="r.time">
        {{ r.userId }} - {{ r.time }}
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const name = ref('')
const users = ref([])
const records = ref([])

async function load() {
  users.value = await fetch('http://localhost:3001/user').then(r => r.json())
  records.value = await fetch('http://localhost:3001/records').then(r => r.json())
}

async function addUser() {
  await fetch('http://localhost:3001/user', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      id: Date.now(),
      name: name.value
    })
  })
  load()
}

onMounted(load)
</script>