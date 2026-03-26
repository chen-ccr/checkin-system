const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveCurrentPunchIndex, evaluateStatus, shouldReplace } = require('../src/services/ruleEngine')

test('规则引擎按时段识别打卡序号', () => {
  const rules = [
    { punch_index: 1, start_time: '08:00:00', end_time: '08:30:00' },
    { punch_index: 2, start_time: '17:00:00', end_time: '22:00:00' }
  ]
  const index = resolveCurrentPunchIndex(rules, new Date('2026-05-01T08:12:00'))
  assert.equal(index, 1)
})

test('规则引擎计算迟到分钟', () => {
  const rule = {
    start_time: '08:00:00',
    winter_start_time: null
  }
  const result = evaluateStatus(rule, '2026-05-01', new Date('2026-05-01T08:16:20'))
  assert.equal(result.status, 'LATE')
  assert.equal(result.lateMinutes, 16)
})

test('重复打卡过滤遵循入场保最早、离场保最晚', () => {
  const entryOld = { punch_index: 1, punched_at: '2026-05-01 08:11:00' }
  const entryNew = new Date('2026-05-01T08:08:00')
  const exitOld = { punch_index: 2, punched_at: '2026-05-01 18:00:00' }
  const exitNew = new Date('2026-05-01T18:30:00')
  assert.equal(shouldReplace(entryOld, entryNew), true)
  assert.equal(shouldReplace(exitOld, exitNew), true)
})
