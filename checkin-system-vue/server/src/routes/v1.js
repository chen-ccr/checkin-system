const express = require('express')
const AppError = require('../errors/AppError')
const errorCodes = require('../constants/errorCodes')
const { requireAuth, requireRole } = require('../middleware/auth')

function parseNumber(value, fieldName) {
  const num = Number(value)
  if (Number.isNaN(num)) {
    throw new AppError(errorCodes.INVALID_INPUT, `${fieldName} 无效`, 422)
  }
  return num
}

function buildV1Router(attendanceService) {
  const router = express.Router()

  router.post('/checkins', async (req, res, next) => {
    try {
      const result = await attendanceService.submitCheckin({
        userId: req.body.userId,
        lat: parseNumber(req.body.lat, 'lat'),
        lng: parseNumber(req.body.lng, 'lng'),
        punchedAt: req.body.punchedAt,
        punchIndex: req.body.punchIndex ? Number(req.body.punchIndex) : undefined,
        fenceId: req.body.fenceId ? Number(req.body.fenceId) : undefined,
        isOffline: Boolean(req.body.isOffline),
        idempotencyKey: req.body.idempotencyKey || null
      })
      res.json({
        code: 'OK',
        message: result.accepted ? '打卡成功' : '重复时段打卡已过滤',
        data: result
      })
    } catch (err) {
      next(err)
    }
  })

  router.post('/checkins/offline', async (req, res, next) => {
    try {
      const items = Array.isArray(req.body.items) ? req.body.items : []
      const results = []
      for (const item of items) {
        const data = await attendanceService.submitCheckin({
          userId: item.userId,
          lat: parseNumber(item.lat, 'lat'),
          lng: parseNumber(item.lng, 'lng'),
          punchedAt: item.punchedAt,
          punchIndex: item.punchIndex ? Number(item.punchIndex) : undefined,
          fenceId: item.fenceId ? Number(item.fenceId) : undefined,
          isOffline: true,
          idempotencyKey: item.idempotencyKey || null
        })
        results.push(data)
      }
      res.json({
        code: 'OK',
        message: '离线补传完成',
        data: results
      })
    } catch (err) {
      next(err)
    }
  })

  router.get('/checkins', requireAuth, async (req, res, next) => {
    try {
      const stats = await attendanceService.getDailyStats(req.query.date)
      res.json({ code: 'OK', data: stats })
    } catch (err) {
      next(err)
    }
  })

  router.post('/integrations/absences', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res, next) => {
    try {
      const payload = Array.isArray(req.body.items) ? req.body.items : []
      const result = await attendanceService.ingestAbsences(payload)
      res.json({ code: 'OK', message: '审批数据接入成功', data: result })
    } catch (err) {
      next(err)
    }
  })

  router.get('/stats/daily', requireAuth, async (req, res, next) => {
    try {
      const data = await attendanceService.getDailyStats(req.query.date)
      res.json({ code: 'OK', data })
    } catch (err) {
      next(err)
    }
  })

  return router
}

module.exports = buildV1Router
