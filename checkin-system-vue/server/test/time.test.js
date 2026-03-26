const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveBusinessDate, isWinterSeason } = require('../src/utils/time')

test('跨天离场在 00:30 内归属前一日', () => {
  const bizDate = resolveBusinessDate(new Date('2026-05-02T00:15:00'))
  assert.equal(bizDate, '2026-05-01')
})

test('00:30 后按当天归属业务日期', () => {
  const bizDate = resolveBusinessDate(new Date('2026-05-02T00:31:00'))
  assert.equal(bizDate, '2026-05-02')
})

test('秋冬季区间识别正确', () => {
  assert.equal(isWinterSeason(new Date('2026-10-01T08:00:00')), true)
  assert.equal(isWinterSeason(new Date('2026-03-31T08:00:00')), true)
  assert.equal(isWinterSeason(new Date('2026-04-01T08:00:00')), false)
})
