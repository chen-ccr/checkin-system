const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const mysql = require('mysql2')

const app = express()
app.use(cors())
app.use(bodyParser.json())

// 2. 直接在 app.js 创建连接池
const db = mysql.createPool({
  host: 'mysql',
  user: 'root',
  password: '123456',
  database: 'checkin',
  waitForConnections: true,
  connectionLimit: 10
}).promise();

// 初始化表
async function init() {
  try {
    console.log('正在初始化数据库表...')
    // 打卡表
    await db.query(`
      CREATE TABLE IF NOT EXISTS checkins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId VARCHAR(50),
        lat DOUBLE,
        lng DOUBLE,
        status VARCHAR(20),
        time BIGINT
      )
    `); 

    // 公司配置表
    await db.query(`
      CREATE TABLE IF NOT EXISTS company (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(50),
        lat DOUBLE,
        lng DOUBLE,
        radius INT,
        start_time VARCHAR(10),
        end_time VARCHAR(10)
      )
    `);
    console.log('数据库初始化成功')
  } catch (err) {
    console.error('数据库初始化失败:', err.message)
  }
}
// 延迟函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function init() {
  let connected = false;
  let attempts = 0;

  // 最多重试 5 次
  while (!connected && attempts < 5) {
    try {
      console.log(`正在尝试连接数据库 (第 ${attempts + 1} 次)...`);
      
      // 这里的 db 就是你之前创建的 pool.promise()
      await db.query('SELECT 1'); 
      
      console.log('数据库连接成功！开始初始化表...');
      
      // 执行建表语句
      await db.query(`CREATE TABLE IF NOT EXISTS checkins (...)`);
      await db.query(`CREATE TABLE IF NOT EXISTS company (...)`);
      
      console.log('数据库初始化成功');
      connected = true;
    } catch (err) {
      attempts++;
      console.error(`连接失败: ${err.message}，5秒后重试...`);
      await sleep(5000); // 等待 5 秒
    }
  }

  if (!connected) {
    console.error('无法连接到数据库，请检查 MySQL 容器状态。');
  }
}

// 打卡
app.post('/api/checkin', async (req, res) => {
  const { userId, lat, lng } = req.body

  const [rows] = await db.query(
    'SELECT * FROM checkins WHERE userId=? AND DATE(FROM_UNIXTIME(time/1000)) = CURDATE()',
    [userId]
  )

  if (rows.length > 0) {
    return res.json({ message: '今天已打卡' })
  }

  const now = Date.now()
  const hour = new Date().getHours()

  const status = hour >= 9 ? 'LATE' : 'NORMAL'

  await db.query(
    'INSERT INTO checkins (userId, lat, lng, status, time) VALUES (?, ?, ?, ?, ?)',
    [userId, lat, lng, status, now]
  )

  res.json({ message: '打卡成功', status })
})

// 列表
app.get('/api/checkin/list', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM checkins ORDER BY id DESC')
  res.json(rows)
})

// 获取配置
app.get('/api/company', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM company LIMIT 1')
  res.json(rows[0])
})

// 更新配置
app.post('/api/company', async (req, res) => {
  const { lat, lng, radius } = req.body

  await db.query(
    'UPDATE company SET lat=?, lng=?, radius=? WHERE id=1',
    [lat, lng, radius]
  )

  res.json({ success: true })
})

app.listen(3001, '0.0.0.0', () => {
  console.log('server running 3001')
})