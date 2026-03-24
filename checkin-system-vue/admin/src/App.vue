
<template>
<div>
<h2>Admin</h2>
<button @click="login">登录</button>
<button @click="load">加载记录</button>
<ul><li v-for="i in list">{{i.userId}} - {{i.time}}</li></ul>
</div>
</template>
<script setup>
import axios from 'axios'
import {ref} from 'vue'
const list=ref([])
let token=''
const login=async()=>{
 const r=await axios.post('http://localhost:3000/api/login',{username:'admin',password:'123456'})
 token=r.data.token
}
const load=async()=>{
 const r=await axios.get('http://localhost:3000/api/records',{headers:{Authorization:token}})
 list.value=r.data
}
</script>
