const express = require('express')
const jwt = require('jsonwebtoken')
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

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1' || value === 1) return true
  if (value === 'false' || value === '0' || value === 0) return false
  return defaultValue
}

function buildV1Router(attendanceService) {
  const router = express.Router()

  router.post('/auth/login', async (req, res, next) => {
    try {
      const userId = String(req.body.userId || '').trim()
      if (!userId) {
        throw new AppError(errorCodes.INVALID_INPUT, 'userId 不能为空', 422)
      }
      const user = await attendanceService.repository.findUserWithRoleById(userId)
      if (!user || Number(user.is_active) !== 1) {
        throw new AppError(errorCodes.UNAUTHORIZED, '账号不可用', 401)
      }
      const superAdminIds = (process.env.SUPER_ADMIN_IDS || 'test123').split(',').map((item) => item.trim())
      const role = superAdminIds.includes(user.id) ? 'SUPER_ADMIN' : 'ADMIN'
      const token = jwt.sign(
        {
          userId: user.id,
          userName: user.name,
          departmentId: user.department_id,
          role
        },
        process.env.JWT_SECRET || 'dev-secret',
        { expiresIn: '12h' }
      )
      res.json({
        code: 'OK',
        data: {
          token,
          profile: {
            userId: user.id,
            userName: user.name,
            departmentId: user.department_id,
            role,
            roleCode: user.role_code
          }
        }
      })
    } catch (err) {
      next(err)
    }
  })

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

  router.post('/checkins/precheck', async (req, res, next) => {
    try {
      const data = await attendanceService.precheckLocation({
        userId: req.body.userId,
        lat: parseNumber(req.body.lat, 'lat'),
        lng: parseNumber(req.body.lng, 'lng'),
        punchedAt: req.body.punchedAt,
        punchIndex: req.body.punchIndex ? Number(req.body.punchIndex) : undefined,
        fenceId: req.body.fenceId ? Number(req.body.fenceId) : undefined
      })
      res.json({ code: 'OK', data })
    } catch (err) {
      next(err)
    }
  })

  router.get('/checkins/plan', async (req, res, next) => {
    try {
      const data = await attendanceService.getUserTodayPlan(req.query.userId, req.query.date)
      res.json({ code: 'OK', data })
    } catch (err) {
      next(err)
    }
  })

  router.get('/checkins/history', async (req, res, next) => {
    try {
      const data = await attendanceService.getUserHistory(req.query.userId, req.query.limit ? Number(req.query.limit) : 30)
      res.json({ code: 'OK', data })
    } catch (err) {
      next(err)
    }
  })

  router.get('/h5/attendance/summary', async (req, res, next) => {
    try {
      const auth = req.auth || { role: 'SUPER_ADMIN', userId: null, departmentId: null }
      const data = await attendanceService.getH5Summary(auth, {
        mode: req.query.mode,
        date: req.query.date,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        departmentId: req.query.departmentId,
        userId: req.query.userId
      })
      res.json({ code: 'OK', data })
    } catch (err) {
      next(err)
    }
  })

  router.get('/h5/attendance/access', async (req, res) => {
    res.json({
      code: 'OK',
      data: {
        canAccess: true
      }
    })
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

  router.get('/admin/bootstrap', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res, next) => {
    try {
      const data = await attendanceService.getAdminBootstrap()
      res.json({ code: 'OK', data })
    } catch (err) {
      next(err)
    }
  })

  router.get('/admin/users', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res, next) => {
    try {
      const data = await attendanceService.listUsersForAdmin(req.auth, req.query)
      res.json({ code: 'OK', data })
    } catch (err) {
      next(err)
    }
  })

  router.post('/admin/users', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res, next) => {
    try {
      const data = await attendanceService.saveUserForAdmin(req.auth, req.body)
      res.json({ code: 'OK', message: '用户保存成功', data })
    } catch (err) {
      next(err)
    }
  })

  router.post('/admin/departments', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res, next) => {
    try {
      const data = await attendanceService.saveDepartmentForAdmin(req.body)
      res.json({ code: 'OK', message: '部门保存成功', data })
    } catch (err) {
      next(err)
    }
  })

  router.post('/admin/geofences', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res, next) => {
    try {
      const data = await attendanceService.saveFenceForAdmin({
        id: req.body.id,
        name: req.body.name,
        lat: req.body.lat,
        lng: req.body.lng,
        radius: req.body.radius,
        isActive: parseBoolean(req.body.isActive, true)
      })
      res.json({ code: 'OK', message: '围栏保存成功', data })
    } catch (err) {
      next(err)
    }
  })

  router.post('/admin/shift-rules', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res, next) => {
    try {
      const data = await attendanceService.saveShiftRuleForAdmin({
        roleId: req.body.roleId,
        punchIndex: req.body.punchIndex,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        winterStartTime: req.body.winterStartTime,
        requiredFenceId: req.body.requiredFenceId
      })
      res.json({ code: 'OK', message: '班次规则保存成功', data })
    } catch (err) {
      next(err)
    }
  })

  router.get('/admin/dashboard', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res, next) => {
    try {
      const data = await attendanceService.getDashboard(req.auth, req.query)
      res.json({ code: 'OK', data })
    } catch (err) {
      next(err)
    }
  })

  router.get('/admin/export', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res, next) => {
    try {
      const file = await attendanceService.exportDashboard(req.auth, req.query)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
      res.send(file.content)
    } catch (err) {
      next(err)
    }
  })

  return router
}

module.exports = buildV1Router
