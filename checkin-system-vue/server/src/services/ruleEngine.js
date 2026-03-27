const AppError = require('../errors/AppError')
const errorCodes = require('../constants/errorCodes')
const { PUNCH_STATUS } = require('../constants/domain')
const { combineDateTime, formatTime, isWinterSeason } = require('../utils/time')

function toMinutes(timeText) {
  const [h, m] = timeText.split(':').map((item) => Number(item))
  return h * 60 + m
}

function resolveCurrentPunchIndex(rules, punchAt) {
  const timeText = formatTime(punchAt)
  const currentMinutes = toMinutes(timeText)
  const matched = rules.find((rule) => {
    const startMinutes = toMinutes(rule.start_time)
    const endMinutes = toMinutes(rule.end_time)
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes
  })
  if (!matched) {
    throw new AppError(errorCodes.INVALID_INPUT, '当前时间不在任何有效打卡时段', 422)
  }
  return matched.punch_index
}

function evaluateStatus(rule, bizDate, punchAt) {
  const startTime = isWinterSeason(punchAt) && rule.winter_start_time ? rule.winter_start_time : rule.start_time
  const startAt = combineDateTime(bizDate, startTime)
  const lateMillis = punchAt.getTime() - startAt.getTime()
  if (lateMillis <= 0) {
    return { status: PUNCH_STATUS.NORMAL, lateMinutes: 0 }
  }
  return {
    status: PUNCH_STATUS.LATE,
    lateMinutes: Math.floor(lateMillis / 60000)
  }
}

function shouldReplace(existing, incoming) {
  const incomingAt = incoming.getTime()
  const existingAt = new Date(existing.punched_at).getTime()
  if (existing.punch_index % 2 === 1) {
    return incomingAt < existingAt
  }
  return incomingAt > existingAt
}

module.exports = {
  resolveCurrentPunchIndex,
  evaluateStatus,
  shouldReplace
}
