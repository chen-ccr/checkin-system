const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const { createPool } = require('./src/db/pool')
const { migrate } = require('./src/db/migrate')
const AttendanceRepository = require('./src/repositories/attendanceRepository')
const AttendanceService = require('./src/services/attendanceService')
const buildV1Router = require('./src/routes/v1')
const { notFoundHandler, errorHandler } = require('./src/middleware/errorHandler')
const { requireAuth } = require('./src/middleware/auth')

async function initDatabase(db) {
  let attempts = 0
  while (attempts < 5) {
    try {
      await db.query('SELECT 1')
      await migrate(db)
      return
    } catch (err) {
      attempts += 1
      if (attempts >= 5) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

function createApp({ attendanceService }) {
  const app = express()
  app.use(cors())
  app.use(bodyParser.json())

  const v1Router = buildV1Router(attendanceService)
  app.use('/api/v1', v1Router)

  app.post('/api/checkin', async (req, res, next) => {
    try {
      const result = await attendanceService.submitCheckin({
        userId: req.body.userId,
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
        punchedAt: req.body.punchedAt,
        punchIndex: req.body.punchIndex ? Number(req.body.punchIndex) : undefined,
        isOffline: false,
        idempotencyKey: req.body.idempotencyKey || null
      })
      res.json({ message: result.accepted ? '打卡成功' : '重复时段打卡已过滤', status: result.status, data: result })
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/checkin/list', requireAuth, async (req, res, next) => {
    try {
      const stats = await attendanceService.getDailyStats(req.query.date)
      res.json(stats)
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/company', requireAuth, async (req, res, next) => {
    try {
      const data = await attendanceService.repository.getCompanyFence()
      res.json(data)
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/company', requireAuth, async (req, res, next) => {
    try {
      const fence = await attendanceService.repository.getCompanyFence()
      if (!fence) {
        throw new Error('公司围栏不存在')
      }
      await attendanceService.repository.updateCompanyFence({
        id: fence.id,
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
        radius: Number(req.body.radius)
      })
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  })

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

async function bootstrap() {
  const db = createPool()
  await initDatabase(db)
  const repository = new AttendanceRepository(db)
  const attendanceService = new AttendanceService(repository)
  const app = createApp({ attendanceService })
  app.listen(3001, '0.0.0.0', () => {
    console.log('server running 3001')
  })
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = {
  createApp,
  initDatabase
}
