const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveCurrentPunchIndex, evaluateStatus, shouldReplace } = require('../src/services/ruleEngine')
const AppError = require('../src/errors/AppError')

test('规则引擎按时段识别打卡序号', () => {
  const rules = [
    { punch_index: 1, start_time: '08:00:00', end_time: '08:30:00' },
    { punch_index: 2, start_time: '17:00:00', end_time: '22:00:00' }
  ]
  const index = resolveCurrentPunchIndex(rules, new Date('2026-05-01T08:12:00'))
  assert.equal(index, 1)
})

test('规则引擎支持不同角色时段映射', () => {
  const staffRules = [
    { punch_index: 1, start_time: '08:00:00', end_time: '08:30:00' },
    { punch_index: 2, start_time: '12:00:00', end_time: '12:30:00' }
  ]
  const transRules = [
    { punch_index: 1, start_time: '08:00:00', end_time: '10:30:00' },
    { punch_index: 2, start_time: '17:00:00', end_time: '23:30:00' }
  ]
  assert.equal(resolveCurrentPunchIndex(staffRules, new Date('2026-05-01T12:05:00')), 2)
  assert.equal(resolveCurrentPunchIndex(transRules, new Date('2026-05-01T10:20:00')), 1)
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

test('秋冬季自动使用 winter_start_time 计算迟到', () => {
  const rule = {
    start_time: '16:30:00',
    winter_start_time: '17:00:00'
  }
  const result = evaluateStatus(rule, '2026-12-01', new Date('2026-12-01T16:45:00'))
  assert.equal(result.status, 'NORMAL')
  assert.equal(result.lateMinutes, 0)
})

test('重复打卡过滤遵循入场保最早、离场保最晚', () => {
  const entryOld = { punch_index: 1, punched_at: '2026-05-01 08:11:00' }
  const entryNew = new Date('2026-05-01T08:08:00')
  const exitOld = { punch_index: 2, punched_at: '2026-05-01 18:00:00' }
  const exitNew = new Date('2026-05-01T18:30:00')
  assert.equal(shouldReplace(entryOld, entryNew), true)
  assert.equal(shouldReplace(exitOld, exitNew), true)
})

test('超出所有时段时返回业务异常', () => {
  const rules = [{ punch_index: 1, start_time: '08:00:00', end_time: '08:30:00' }]
  assert.throws(
    () => resolveCurrentPunchIndex(rules, new Date('2026-05-01T07:30:00')),
    (err) => err instanceof AppError && err.code === 'INVALID_INPUT'
  )
})
