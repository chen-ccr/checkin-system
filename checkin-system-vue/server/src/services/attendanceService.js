const AppError = require('../errors/AppError')
const errorCodes = require('../constants/errorCodes')
const { ABSENCE_STATUS } = require('../constants/domain')
const { distanceInMeters } = require('../utils/geo')
const { resolveBusinessDate, formatDate, toDate } = require('../utils/time')
const { resolveCurrentPunchIndex, evaluateStatus, shouldReplace } = require('./ruleEngine')

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

    const distanceMeters = Math.round(distanceInMeters(payload.lat, payload.lng, fence.lat, fence.lng))
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
}

module.exports = AttendanceService
