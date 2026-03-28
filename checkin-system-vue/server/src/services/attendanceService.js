const AppError = require('../errors/AppError')
const errorCodes = require('../constants/errorCodes')
const ExcelJS = require('exceljs')
const { ABSENCE_STATUS } = require('../constants/domain')
const { distanceInMeters, distanceWithCoordTransform } = require('../utils/geo')
const { resolveBusinessDate, formatDate, formatDateTime, toDate, isWinterSeason } = require('../utils/time')
const { resolveCurrentPunchIndex, evaluateStatus, shouldReplace } = require('./ruleEngine')

const TEST_MODE = process.env.TEST_MODE === 'true'

class AttendanceService {
  constructor(repository) {
    this.repository = repository
  }

  async submitCheckin(payload) {
    const punchAt = payload.punchedAt ? toDate(payload.punchedAt) : new Date()
    const bizDate = payload.bizDate || resolveBusinessDate(punchAt)
    const user = await this.repository.findUserById(payload.userId)
    if (!user) {
      throw new AppError(errorCodes.NOT_FOUND, '用户不存在或已停用', 404)
    }

    if (payload.idempotencyKey) {
      const existingByIdempotency = await this.repository.findCheckinByIdempotency(payload.idempotencyKey)
      if (existingByIdempotency) {
        return {
          accepted: true,
          duplicated: true,
          message: '重复提交已忽略',
          recordId: existingByIdempotency.id
        }
      }
    }

    const shiftRules = await this.repository.findShiftRulesByRoleId(user.role_id)
    if (!shiftRules.length) {
      throw new AppError(errorCodes.INVALID_INPUT, '角色未配置班次规则', 422)
    }

    const punchIndex = payload.punchIndex || resolveCurrentPunchIndex(shiftRules, punchAt)
    const rule = shiftRules.find((item) => item.punch_index === punchIndex)
    if (!rule) {
      throw new AppError(errorCodes.INVALID_INPUT, '打卡时段无效', 422)
    }

    const fenceId = payload.fenceId || rule.required_fence_id || user.default_fence_id
    const fence = await this.repository.findFenceById(fenceId)
    if (!fence || !fence.is_active) {
      throw new AppError(errorCodes.INVALID_INPUT, '围栏未配置或不可用', 422)
    }

    const distanceMeters = Math.round(distanceWithCoordTransform(payload.lat, payload.lng, fence.lat, fence.lng, 'WGS84'))
    if (distanceMeters > fence.radius) {
      throw new AppError(errorCodes.OUTSIDE_FENCE, '超出打卡范围', 422, { distanceMeters, radius: fence.radius, fence: fence.name })
    }

    const statusResult = evaluateStatus(rule, bizDate, punchAt)
    const existingSlot = await this.repository.findCheckinBySlot(payload.userId, bizDate, punchIndex)

    const recordPayload = {
      userId: payload.userId,
      bizDate,
      punchIndex,
      punchedAt: formatDate(punchAt) + ' ' + punchAt.toTimeString().slice(0, 8),
      lat: payload.lat,
      lng: payload.lng,
      fenceId: fence.id,
      distanceMeters,
      status: statusResult.status,
      lateMinutes: statusResult.lateMinutes,
      isOffline: Boolean(payload.isOffline),
      idempotencyKey: payload.idempotencyKey || null
    }

    let accepted = true
    let replaced = false
    let recordId
    if (!existingSlot) {
      recordId = await this.repository.createCheckin(recordPayload)
    } else if (shouldReplace(existingSlot, punchAt)) {
      await this.repository.updateCheckinRecord(existingSlot.id, recordPayload)
      recordId = existingSlot.id
      replaced = true
    } else {
      accepted = false
      recordId = existingSlot.id
    }

    await this.repository.createUploadAudit({
      userId: payload.userId,
      idempotencyKey: payload.idempotencyKey || null,
      source: payload.isOffline ? 'OFFLINE' : 'ONLINE',
      accepted,
      reason: accepted ? null : 'REPEATED_SLOT_FILTERED',
      payload
    })

    return {
      accepted,
      replaced,
      recordId,
      status: statusResult.status,
      lateMinutes: statusResult.lateMinutes,
      bizDate,
      punchIndex,
      distanceMeters,
      fenceName: fence.name,
      source: payload.isOffline ? 'OFFLINE' : 'ONLINE'
    }
  }

  async ingestAbsences(payload) {
    for (const item of payload) {
      await this.repository.upsertAbsence({
        userId: item.userId,
        type: item.type,
        startAt: item.startAt,
        endAt: item.endAt,
        status: item.status || ABSENCE_STATUS.APPROVED,
        source: item.source || 'integration',
        externalId: item.externalId
      })
    }
    return { count: payload.length }
  }

  async getDailyStats(dateInput) {
    const bizDate = dateInput || formatDate(new Date())
    const users = await this.repository.listActiveUsers()
    const checkins = await this.repository.listDailyCheckins(bizDate)
    const absences = await this.repository.listApprovedAbsencesCoveringDate(bizDate)
    const absenceUsers = new Set(absences.map((item) => item.user_id))

    const checkinByUser = checkins.reduce((acc, item) => {
      if (!acc[item.user_id]) acc[item.user_id] = []
      acc[item.user_id].push(item)
      return acc
    }, {})

    let expected = 0
    let actual = 0
    let late = 0
    let leave = 0
    let missing = 0
    const abnormalUsers = []

    for (const user of users) {
      const shifts = await this.repository.findShiftRulesByRoleId(user.role_id)
      const expectedCount = shifts.length
      const userCheckins = checkinByUser[user.id] || []
      const actualCount = userCheckins.length
      const isLeave = absenceUsers.has(user.id)

      expected += expectedCount
      actual += actualCount
      late += userCheckins.filter((item) => item.late_minutes > 0).length
      if (isLeave) {
        leave += 1
      } else if (actualCount < expectedCount) {
        missing += expectedCount - actualCount
        abnormalUsers.push({
          userId: user.id,
          userName: user.name,
          missingCount: expectedCount - actualCount
        })
      }
    }

    return {
      date: bizDate,
      expected,
      actual,
      late,
      leave,
      missing,
      abnormalUsers
    }
  }

  resolveScopedDepartment(auth, departmentId) {
    if (auth.role === 'SUPER_ADMIN') {
      return departmentId ? Number(departmentId) : null
    }
    return Number(auth.departmentId)
  }

  resolveRange(query = {}) {
    const mode = query.mode || 'day'
    if (query.startDate && query.endDate) {
      return { startDate: query.startDate, endDate: query.endDate, mode: 'custom' }
    }
    const current = query.date ? new Date(`${query.date}T00:00:00`) : new Date()
    const date = new Date(current)
    if (mode === 'week') {
      const day = date.getDay() || 7
      const start = new Date(date)
      start.setDate(date.getDate() - day + 1)
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      return { startDate: formatDate(start), endDate: formatDate(end), mode }
    }
    if (mode === 'month') {
      const start = new Date(date.getFullYear(), date.getMonth(), 1)
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
      return { startDate: formatDate(start), endDate: formatDate(end), mode }
    }
    const target = formatDate(date)
    return { startDate: target, endDate: target, mode: 'day' }
  }

  countDays(startDate, endDate) {
    const start = toDate(`${startDate}T00:00:00`)
    const end = toDate(`${endDate}T00:00:00`)
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
  }

  countOverlapDays(startDate, endDate, absenceStartAt, absenceEndAt) {
    const rangeStart = toDate(`${startDate}T00:00:00`)
    const rangeEnd = toDate(`${endDate}T23:59:59`)
    const leaveStart = toDate(absenceStartAt)
    const leaveEnd = toDate(absenceEndAt)
    const overlapStart = new Date(Math.max(rangeStart.getTime(), leaveStart.getTime()))
    const overlapEnd = new Date(Math.min(rangeEnd.getTime(), leaveEnd.getTime()))
    if (overlapStart.getTime() > overlapEnd.getTime()) {
      return 0
    }
    const startOnly = toDate(`${formatDate(overlapStart)}T00:00:00`)
    const endOnly = toDate(`${formatDate(overlapEnd)}T00:00:00`)
    return Math.floor((endOnly.getTime() - startOnly.getTime()) / 86400000) + 1
  }

  resolvePunchType(punchIndex) {
    return Number(punchIndex) % 2 === 1 ? '上班' : '下班'
  }

  canAccessH5Summary(auth) {
    if (TEST_MODE) return true
    return true
    // if (auth.role === 'SUPER_ADMIN') return true
    // const allowIds = (process.env.H5_SUMMARY_USER_IDS || 'staff001')
    //   .split(',')
    //   .map((item) => item.trim())
    //   .filter(Boolean)
    // return allowIds.includes(String(auth.userId || ''))
  }

  async getAdminBootstrap() {
    const [departments, roles, geofences, shiftRules] = await Promise.all([
      this.repository.listDepartments(),
      this.repository.listRoles(),
      this.repository.listGeofences(),
      this.repository.listShiftRules()
    ])
    return { departments, roles, geofences, shiftRules }
  }

  async listUsersForAdmin(auth, query = {}) {
    const departmentId = this.resolveScopedDepartment(auth, query.departmentId ? Number(query.departmentId) : null)
    return this.repository.listUsers({
      departmentId: departmentId || undefined
    })
  }

  async saveUserForAdmin(auth, payload) {
    const departmentId = this.resolveScopedDepartment(auth, Number(payload.departmentId))
    const data = {
      id: String(payload.id || '').trim(),
      name: String(payload.name || '').trim(),
      nickname: payload.nickname ? String(payload.nickname).trim() : null,
      phone: payload.phone ? String(payload.phone).trim() : null,
      roleId: Number(payload.roleId),
      departmentId: Number(departmentId),
      isActive: payload.isActive !== false
    }
    if (!data.id || !data.name || Number.isNaN(data.roleId) || Number.isNaN(data.departmentId)) {
      throw new AppError(errorCodes.INVALID_INPUT, '用户参数不完整', 422)
    }
    const existed = await this.repository.findUserWithRoleById(data.id)
    if (!existed) {
      await this.repository.createUser(data)
      return { created: true }
    }
    await this.repository.updateUser(data)
    return { updated: true }
  }

  async deleteUser(userId) {
    await this.repository.deleteUser(userId)
  }

  async deleteShiftRule(id) {
    await this.repository.deleteShiftRule(id)
  }

  async getUserInfoByMobile(mobile) {
    if (!mobile) {
      return { exists: false }
    }
    const user = await this.repository.findUserByPhone(String(mobile).trim())
    if (!user) {
      return { exists: false }
    }
    const dept = await this.repository.findDepartmentById(user.department_id)
    return {
      exists: true,
      userId: user.id,
      name: user.nickname || user.name,
      nickname: user.nickname,
      mobile: user.phone,
      departmentId: Number(user.department_id),
      departmentName: dept?.name || '未知',
      roleId: Number(user.role_id)
    }
  }

  async autoCreateUser(payload) {
    const { userId, mobile, name, nickName } = payload
    if (!mobile) {
      throw new AppError(errorCodes.INVALID_INPUT, '手机号不能为空', 422)
    }
    if (!userId) {
      throw new AppError(errorCodes.INVALID_INPUT, 'userId不能为空', 422)
    }
    const existingByPhone = await this.repository.findUserByPhone(mobile)
    if (existingByPhone) {
      const dept = await this.repository.findDepartmentById(existingByPhone.department_id)
      if (!existingByPhone.nickname && nickName) {
        await this.repository.updateUserNickname(existingByPhone.id, nickName)
        existingByPhone.nickname = nickName
      }
      return {
        userId: existingByPhone.id,
        name: existingByPhone.nickname || existingByPhone.name,
        mobile: existingByPhone.phone,
        departmentId: Number(existingByPhone.department_id),
        departmentName: dept?.name || '未知',
        roleId: Number(existingByPhone.role_id),
        isNew: false
      }
    }
    const unknownDept = await this.repository.findDepartmentByName('未知')
    let departmentId
    if (unknownDept) {
      departmentId = unknownDept.id
    } else {
      const result = await this.repository.createDepartment('未知')
      departmentId = result
    }
    const staffRole = await this.repository.findRoleByCode('STAFF')
    const roleId = staffRole ? staffRole.id : 1
    await this.repository.createUser({
      id: String(userId),
      name: name || '未知',
      nickname: nickName || null,
      phone: mobile,
      departmentId,
      roleId,
      isActive: true
    })
    return {
      userId: String(userId),
      name: nickName || name || '未知',
      mobile,
      departmentId,
      departmentName: '未知',
      roleId,
      isNew: true
    }
  }

  async saveDepartmentForAdmin(payload) {
    const name = String(payload.name || '').trim()
    if (!name) {
      throw new AppError(errorCodes.INVALID_INPUT, '部门名称不能为空', 422)
    }
    await this.repository.createDepartment(name)
    return { created: true }
  }

  async saveFenceForAdmin(payload) {
    const data = {
      id: payload.id ? Number(payload.id) : null,
      name: String(payload.name || '').trim(),
      lat: Number(payload.lat),
      lng: Number(payload.lng),
      radius: Number(payload.radius),
      isActive: payload.isActive !== false
    }
    if (!data.name || Number.isNaN(data.lat) || Number.isNaN(data.lng) || Number.isNaN(data.radius)) {
      throw new AppError(errorCodes.INVALID_INPUT, '围栏参数不完整', 422)
    }
    if (data.id) {
      await this.repository.updateGeofence(data)
      return { updated: true }
    }
    await this.repository.createGeofence(data)
    return { created: true }
  }

  async saveShiftRuleForAdmin(payload) {
    const data = {
      id: payload.id ? Number(payload.id) : null,
      roleId: Number(payload.roleId),
      punchIndex: Number(payload.punchIndex),
      startTime: payload.startTime,
      endTime: payload.endTime,
      winterStartTime: payload.winterStartTime || null,
      requiredFenceId: payload.requiredFenceId ? Number(payload.requiredFenceId) : null
    }
    if (Number.isNaN(data.roleId) || Number.isNaN(data.punchIndex) || !data.startTime || !data.endTime) {
      throw new AppError(errorCodes.INVALID_INPUT, '班次参数不完整', 422)
    }
    await this.repository.upsertShiftRule(data)
    return { updated: !!payload.id }
  }

  async getDashboard(auth, query = {}) {
    const range = this.resolveRange(query)
    const scopedDepartmentId = this.resolveScopedDepartment(auth, query.departmentId ? Number(query.departmentId) : null)
    const filters = {
      startDate: range.startDate,
      endDate: range.endDate,
      departmentId: scopedDepartmentId || undefined,
      userId: query.userId || undefined
    }
    const [users, checkins, absences] = await Promise.all([
      this.repository.listUsers({
        departmentId: scopedDepartmentId || undefined,
        onlyActive: true
      }),
      this.repository.listCheckinsByRange(filters),
      this.repository.listApprovedAbsencesInRange(range.startDate, range.endDate)
    ])
    const shiftCounts = {}
    for (const user of users) {
      if (!shiftCounts[user.role_id]) {
        const shifts = await this.repository.findShiftRulesByRoleId(user.role_id)
        shiftCounts[user.role_id] = shifts.length
      }
    }
    const days = this.countDays(range.startDate, range.endDate)
    let expected = 0
    for (const user of users) {
      expected += (shiftCounts[user.role_id] || 0) * days
    }
    const actual = checkins.length
    const late = checkins.filter((item) => Number(item.late_minutes) > 0).length
    const leaveUserIds = new Set(absences.map((item) => item.user_id))
    const leave = leaveUserIds.size
    const missing = Math.max(expected - actual, 0)
    const abnormalMap = {}
    for (const row of checkins) {
      if (!abnormalMap[row.user_id]) {
        abnormalMap[row.user_id] = {
          userId: row.user_id,
          userName: row.user_name,
          departmentName: row.department_name,
          lateCount: 0,
          offlineCount: 0
        }
      }
      if (Number(row.late_minutes) > 0) abnormalMap[row.user_id].lateCount += 1
      if (Number(row.is_offline) === 1) abnormalMap[row.user_id].offlineCount += 1
    }
    const abnormalUsers = Object.values(abnormalMap).filter((item) => item.lateCount > 0 || item.offlineCount > 0)
    return {
      range,
      summary: {
        expected,
        actual,
        late,
        leave,
        missing
      },
      abnormalUsers,
      records: checkins
    }
  }

  async getH5Summary(auth, query = {}) {
    if (!TEST_MODE && !this.canAccessH5Summary(auth)) {
      throw new AppError(errorCodes.FORBIDDEN, '无权访问考勤汇总', 403)
    }
    const range = this.resolveRange(query)
    const requestedDepartmentId = query.departmentId ? Number(query.departmentId) : null
    const scopedDepartmentId = TEST_MODE ? requestedDepartmentId : this.resolveScopedDepartment(auth, requestedDepartmentId)
    const targetUserId = query.userId ? String(query.userId).trim() : ''
    const isAdmin = TEST_MODE || auth.role === 'SUPER_ADMIN' || auth.role === 'ADMIN'
    if (!TEST_MODE && targetUserId && !isAdmin && targetUserId !== auth.userId) {
      throw new AppError(errorCodes.FORBIDDEN, '无权查看该人员汇总', 403)
    }
    const filters = {
      startDate: range.startDate,
      endDate: range.endDate,
      departmentId: scopedDepartmentId || undefined,
      userId: targetUserId || undefined
    }
    const [allUsers, checkins, absences, departments] = await Promise.all([
      this.repository.listUsers({
        departmentId: scopedDepartmentId || undefined,
        onlyActive: true
      }),
      this.repository.listCheckinsByRange(filters),
      this.repository.listApprovedAbsencesInRange(range.startDate, range.endDate),
      this.repository.listDepartments()
    ])

    const users = targetUserId ? allUsers.filter((item) => item.id === targetUserId) : allUsers
    if (targetUserId && users.length === 0) {
      throw new AppError(errorCodes.NOT_FOUND, '人员不存在或无权限', 404)
    }

    const shiftCountByRole = {}
    for (const user of users) {
      if (!shiftCountByRole[user.role_id]) {
        const shifts = await this.repository.findShiftRulesByRoleId(user.role_id)
        shiftCountByRole[user.role_id] = shifts.length
      }
    }

    const recordsByUser = checkins.reduce((acc, item) => {
      if (!acc[item.user_id]) acc[item.user_id] = []
      acc[item.user_id].push(item)
      return acc
    }, {})
    const absencesByUser = absences.reduce((acc, item) => {
      if (!acc[item.user_id]) acc[item.user_id] = []
      acc[item.user_id].push(item)
      return acc
    }, {})
    const days = this.countDays(range.startDate, range.endDate)

    const userMetrics = users.map((user) => {
      const userCheckins = recordsByUser[user.id] || []
      const userAbsences = absencesByUser[user.id] || []
      const leaveDays = userAbsences.reduce((sum, absence) => {
        return sum + this.countOverlapDays(range.startDate, range.endDate, absence.start_at, absence.end_at)
      }, 0)
      return {
        userId: user.id,
        userName: user.name,
        departmentId: Number(user.department_id),
        departmentName: user.department_name,
        expected: (shiftCountByRole[user.role_id] || 0) * days,
        actual: userCheckins.length,
        late: userCheckins.filter((item) => Number(item.late_minutes) > 0).length,
        leaveDays
      }
    })

    const summaryBase = userMetrics.reduce(
      (acc, item) => {
        acc.expected += item.expected
        acc.actual += item.actual
        acc.late += item.late
        return acc
      },
      { expected: 0, actual: 0, late: 0 }
    )

    const response = {
      range,
      mode: range.mode,
      summary: {
        expected: summaryBase.expected,
        actual: summaryBase.actual,
        late: summaryBase.late,
        leave: 0
      },
      departments: departments
        .filter((item) => !scopedDepartmentId || Number(item.id) === Number(scopedDepartmentId))
        .map((item) => ({ id: Number(item.id), name: item.name })),
      bars: [],
      rows: [],
      records: []
    }

    if (targetUserId) {
      const target = userMetrics[0]
      response.level = 'user'
      response.title = `${target.userName}的考勤`
      response.summary.leave = target.leaveDays
      response.records = (recordsByUser[targetUserId] || [])
        .slice()
        .sort((a, b) => String(b.punched_at).localeCompare(String(a.punched_at)))
        .map((item) => ({
          id: item.id,
          bizDate: item.biz_date,
          punchedAt: formatDateTime(item.punched_at),
          punchType: this.resolvePunchType(item.punch_index),
          status: item.status,
          lateMinutes: Number(item.late_minutes || 0)
        }))
      return response
    }

    if (scopedDepartmentId) {
      response.level = 'department'
      response.summary.leave = userMetrics.filter((item) => item.leaveDays > 0).length
      response.bars = userMetrics.map((item) => ({
        id: item.userId,
        name: item.userName,
        expected: item.expected,
        actual: item.actual
      }))
      response.rows = userMetrics.map((item) => ({
        id: item.userId,
        name: item.userName,
        expected: item.expected,
        actual: item.actual,
        late: item.late,
        leave: item.leaveDays
      }))
      return response
    }

    const departmentMap = {}
    for (const item of userMetrics) {
      if (!departmentMap[item.departmentId]) {
        departmentMap[item.departmentId] = {
          id: item.departmentId,
          name: item.departmentName,
          expected: 0,
          actual: 0,
          late: 0,
          leaveUsers: 0
        }
      }
      const target = departmentMap[item.departmentId]
      target.expected += item.expected
      target.actual += item.actual
      target.late += item.late
      if (item.leaveDays > 0) target.leaveUsers += 1
    }
    const departmentRows = Object.values(departmentMap)
    response.level = 'organization'
    response.summary.leave = departmentRows.reduce((sum, item) => sum + item.leaveUsers, 0)
    response.bars = departmentRows.map((item) => ({
      id: item.id,
      name: item.name,
      expected: item.expected,
      actual: item.actual
    }))
    response.rows = departmentRows.map((item) => ({
      id: item.id,
      name: item.name,
      expected: item.expected,
      actual: item.actual,
      late: item.late,
      leave: item.leaveUsers
    }))
    return response
  }

  async exportDashboard(auth, query = {}) {
    const result = await this.getDashboard(auth, query)
    const workbook = new ExcelJS.Workbook()
    const summarySheet = workbook.addWorksheet('汇总报表')
    const detailSheet = workbook.addWorksheet('明细报表')
    const headerFill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1D4ED8' }
    }
    const warnFill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF59E0B' }
    }
    const dangerFill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEF4444' }
    }
    const lightWarnFill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFDE68A' }
    }
    summarySheet.columns = [
      { header: '指标', key: 'name', width: 22 },
      { header: '数值', key: 'value', width: 14 }
    ]
    summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    summarySheet.getRow(1).fill = headerFill
    summarySheet.addRows([
      { name: '统计范围', value: `${result.range.startDate} 至 ${result.range.endDate}` },
      { name: '应到', value: result.summary.expected },
      { name: '实到', value: result.summary.actual },
      { name: '迟到', value: result.summary.late },
      { name: '请假', value: result.summary.leave },
      { name: '缺卡', value: result.summary.missing }
    ])
    const summaryWarnRows = [4, 6]
    for (const rowIndex of summaryWarnRows) {
      const cell = summarySheet.getCell(`B${rowIndex}`)
      if (Number(cell.value) > 0) {
        cell.fill = warnFill
        cell.font = { bold: true }
      }
    }
    const summaryDangerCell = summarySheet.getCell('B7')
    if (Number(summaryDangerCell.value) > 0) {
      summaryDangerCell.fill = dangerFill
      summaryDangerCell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    }
    summarySheet.addRow([])
    summarySheet.addRow(['异常人员', '部门', '迟到次数', '离线次数'])
    const abnormalHeaderRow = summarySheet.lastRow
    abnormalHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    abnormalHeaderRow.fill = headerFill
    for (const item of result.abnormalUsers) {
      const row = summarySheet.addRow([item.userName, item.departmentName, item.lateCount, item.offlineCount])
      if (Number(item.lateCount) > 0 || Number(item.offlineCount) > 0) {
        row.eachCell((cell) => {
          cell.fill = lightWarnFill
        })
      }
    }
    detailSheet.columns = [
      { header: '日期', key: 'bizDate', width: 14 },
      { header: '部门', key: 'departmentName', width: 18 },
      { header: '人员', key: 'userName', width: 14 },
      { header: '角色', key: 'roleCode', width: 12 },
      { header: '节点', key: 'punchIndex', width: 8 },
      { header: '打卡时间', key: 'punchedAt', width: 22 },
      { header: '状态', key: 'status', width: 12 },
      { header: '迟到分钟', key: 'lateMinutes', width: 12 },
      { header: '地点', key: 'fenceName', width: 18 },
      { header: '离线上传', key: 'isOffline', width: 12 },
      { header: '异常标记', key: 'marks', width: 22 }
    ]
    detailSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    detailSheet.getRow(1).fill = headerFill
    for (const row of result.records) {
      const marks = []
      if (Number(row.late_minutes) > 0) marks.push('迟到')
      if (Number(row.is_offline) === 1) marks.push('离线上传')
      if (Number(row.distance_meters) > 200) marks.push('位置偏移')
      const inserted = detailSheet.addRow({
        bizDate: row.biz_date,
        departmentName: row.department_name,
        userName: row.user_name,
        roleCode: row.role_code,
        punchIndex: row.punch_index,
        punchedAt: row.punched_at,
        status: row.status,
        lateMinutes: row.late_minutes,
        fenceName: row.fence_name || '',
        isOffline: Number(row.is_offline) === 1 ? '是' : '否',
        marks: marks.join('|')
      })
      if (Number(row.late_minutes) > 0) {
        inserted.getCell(7).fill = warnFill
        inserted.getCell(8).fill = warnFill
      }
      if (Number(row.is_offline) === 1) {
        inserted.getCell(10).fill = lightWarnFill
      }
      if (Number(row.distance_meters) > 200 || marks.length > 1) {
        inserted.getCell(11).fill = dangerFill
        inserted.getCell(11).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      }
    }
    const content = await workbook.xlsx.writeBuffer()
    return {
      fileName: `attendance-${result.range.startDate}-${result.range.endDate}.xlsx`,
      content
    }
  }

  async getUserTodayPlan(userId, dateInput) {
    const bizDate = dateInput || formatDate(new Date())
    const user = await this.repository.findUserById(userId)
    if (!user) {
      throw new AppError(errorCodes.NOT_FOUND, '用户不存在或已停用', 404)
    }
    const [rules, dailyRecords] = await Promise.all([
      this.repository.findShiftRulesByRoleId(user.role_id),
      this.repository.listDailyCheckins(bizDate)
    ])
    const userRecords = dailyRecords.filter((item) => item.user_id === userId)
    const recordByIndex = userRecords.reduce((acc, item) => {
      acc[item.punch_index] = item
      return acc
    }, {})
    const nodes = rules.map((rule) => {
      const now = new Date()
      const effectiveStartTime = isWinterSeason(now) && rule.winter_start_time ? rule.winter_start_time : rule.start_time
      const record = recordByIndex[rule.punch_index]
      return {
        punchIndex: rule.punch_index,
        startTime: effectiveStartTime,
        endTime: rule.end_time,
        winterStartTime: rule.winter_start_time,
        checked: Boolean(record),
        status: record?.status || 'PENDING',
        punchedAt: record ? formatDateTime(record.punched_at) : null
      }
    })
    return {
      userId: user.id,
      userName: user.name,
      roleCode: user.role_code,
      bizDate,
      nodes
    }
  }

  async precheckLocation(payload) {
    const user = await this.repository.findUserById(payload.userId)
    if (!user) {
      throw new AppError(errorCodes.NOT_FOUND, '用户不存在或已停用', 404)
    }
    const rules = await this.repository.findShiftRulesByRoleId(user.role_id)
    if (!rules.length) {
      throw new AppError(errorCodes.INVALID_INPUT, '角色未配置班次规则', 422)
    }
    const now = payload.punchedAt ? toDate(payload.punchedAt) : new Date()
    const punchIndex = payload.punchIndex || resolveCurrentPunchIndex(rules, now)
    const rule = rules.find((item) => item.punch_index === punchIndex)
    if (!rule) {
      throw new AppError(errorCodes.INVALID_INPUT, '打卡时段无效', 422)
    }
    const fenceId = payload.fenceId || rule.required_fence_id || user.default_fence_id
    const fence = await this.repository.findFenceById(fenceId)
    if (!fence) {
      throw new AppError(errorCodes.INVALID_INPUT, '围栏未配置', 422)
    }
    const distanceMeters = Math.round(distanceWithCoordTransform(payload.lat, payload.lng, fence.lat, fence.lng, 'WGS84'))
    const inside = distanceMeters <= fence.radius
    return {
      punchIndex,
      fenceName: fence.name,
      distanceMeters,
      radius: fence.radius,
      inside,
      message: inside ? '在围栏范围内，可打卡' : '超出围栏范围，请靠近指定地点'
    }
  }

  async getUserHistory(userId, limit) {
    const user = await this.repository.findUserById(userId)
    if (!user) {
      throw new AppError(errorCodes.NOT_FOUND, '用户不存在或已停用', 404)
    }
    const records = await this.repository.listUserCheckins(userId, limit || 30)
    return {
      userId,
      records: records.map((item) => ({
        ...item,
        biz_date: formatDate(item.biz_date),
        punched_at: formatDateTime(item.punched_at)
      }))
    }
  }
}

module.exports = AttendanceService
