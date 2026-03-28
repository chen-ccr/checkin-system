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
  
  const sortedRules = [...rules].sort((a, b) => a.punch_index - b.punch_index)
  
  const inRangeRule = sortedRules.find((rule) => {
    const startMinutes = toMinutes(rule.start_time)
    const endMinutes = toMinutes(rule.end_time)
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes
  })
  if (inRangeRule) {
    return inRangeRule.punch_index
  }
  
  for (let i = 0; i < sortedRules.length; i++) {
    const rule = sortedRules[i]
    const startMinutes = toMinutes(rule.start_time)
    const endMinutes = toMinutes(rule.end_time)
    
    if (rule.punch_index % 2 === 1) {
      if (currentMinutes < startMinutes) {
        return rule.punch_index
      }
    } else {
      if (currentMinutes > endMinutes) {
        if (i === sortedRules.length - 1) {
          return rule.punch_index
        }
        const nextRule = sortedRules[i + 1]
        const nextStartMinutes = toMinutes(nextRule.start_time)
        if (currentMinutes < nextStartMinutes) {
          return rule.punch_index
        }
      }
    }
  }
  
  for (let i = sortedRules.length - 1; i >= 0; i--) {
    const rule = sortedRules[i]
    const startMinutes = toMinutes(rule.start_time)
    if (currentMinutes < startMinutes) {
      return rule.punch_index
    }
  }
  
  throw new AppError(errorCodes.INVALID_INPUT, '当前时间不在任何有效打卡时段', 422)
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
