
const express = require('express')
const jwt = require('jsonwebtoken')
const cors = require('cors')
const dayjs = require('dayjs')

const app = express()
app.use(cors())
app.use(express.json())

let users = [{id:1,username:'admin',password:'123456'}]
let records = []

app.post('/api/login',(req,res)=>{
  const u = users.find(i=>i.username===req.body.username && i.password===req.body.password)
  if(!u) return res.send({msg:'error'})
  res.send({token: jwt.sign({id:u.id},'secret')})
})

const auth=(req,res,next)=>{
  try{
    req.user = jwt.verify(req.headers.authorization,'secret')
    next()
  }catch{
    res.send({msg:'no auth'})
  }
}

app.post('/api/checkin',auth,(req,res)=>{
  records.push({id:Date.now(),userId:req.user.id,time:dayjs().format()})
  res.send({msg:'ok'})
})

app.get('/api/records',auth,(req,res)=>res.send(records))

app.listen(3000,()=>console.log('ok'))
