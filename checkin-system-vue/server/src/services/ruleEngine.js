const AppError = require('../errors/AppError')
const errorCodes = require('../constants/errorCodes')
const { PUNCH_STATUS } = require('../constants/domain')
const { combineDateTime, formatTime, isWinterSeason } = require('../utils/time')

function toMinutes(timeText) {
  const [h, m] = timeText.split(':').map((item) => Number(item))
  return h * 60 + m
}

function resolveCurrentPunchIndex(rules, punchAt) {
  console.log('=== resolveCurrentPunchIndex 调试 ===')
  console.log('punchAt 原始值:', punchAt)
  console.log('punchAt 类型:', typeof punchAt)
  const timeText = formatTime(punchAt)
  console.log('formatTime 结果:', timeText)
  const currentMinutes = toMinutes(timeText)
  console.log('currentMinutes:', currentMinutes, `(${Math.floor(currentMinutes/60)}时${currentMinutes%60}分)`)
  console.log('规则数量:', rules.length)
  rules.forEach((rule, idx) => {
    const startMinutes = toMinutes(rule.start_time)
    const endMinutes = toMinutes(rule.end_time)
    console.log(`规则${idx}: punch_index=${rule.punch_index}, start_time=${rule.start_time}(${startMinutes}), end_time=${rule.end_time}(${endMinutes})`)
  })
  const matched = rules.find((rule) => {
    const startMinutes = toMinutes(rule.start_time)
    const endMinutes = toMinutes(rule.end_time)
    const inRange = currentMinutes >= startMinutes && currentMinutes <= endMinutes
    console.log(`检查规则 punch_index=${rule.punch_index}: ${currentMinutes} >= ${startMinutes} && ${currentMinutes} <= ${endMinutes} = ${inRange}`)
    return inRange
  })
  console.log('匹配结果:', matched ? `punch_index=${matched.punch_index}` : '未匹配')
  if (!matched) {
    throw new AppError(errorCodes.INVALID_INPUT, '当前时间不在任何有效打卡时段', 422)
  }
  return matched.punch_index
}

function evaluateStatus(rule, bizDate, punchAt) {
  const startTime = isWinterSeason(punchAt) && rule.winter_start_time ? rule.winter_start_time : rule.start_time
  const startAt = combineDateTime(bizDate, startTime)
  console.log('=== evaluateStatus 调试 ===')
  console.log('bizDate:', bizDate)
  console.log('startTime:', startTime)
  console.log('startAt:', startAt)
  console.log('startAt.toISOString():', startAt.toISOString())
  console.log('punchAt:', punchAt)
  console.log('punchAt.toISOString():', punchAt.toISOString())
  const lateMillis = punchAt.getTime() - startAt.getTime()
  console.log('lateMillis:', lateMillis, 'lateMinutes:', Math.floor(lateMillis / 60000))
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
