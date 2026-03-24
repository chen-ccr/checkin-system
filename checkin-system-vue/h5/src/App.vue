
<template>
<div>
<h3>H5打卡</h3>
<button @click="login">登录</button>
<button @click="checkin">打卡</button>
</div>
</template>
<script setup>
import axios from 'axios'
let token=''
const login=async()=>{
 const r=await axios.post('http://localhost:3000/api/login',{username:'admin',password:'123456'})
 token=r.data.token
}
const checkin=async()=>{
 await axios.post('http://localhost:3000/api/checkin',{}, {headers:{Authorization:token}})
 alert('ok')
}
</script>
