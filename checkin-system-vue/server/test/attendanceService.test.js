const test = require('node:test')
const assert = require('node:assert/strict')
const AttendanceService = require('../src/services/attendanceService')

function createFakeRepository() {
  const state = {
    checkins: [],
    audios: [],
    absences: [],
    users: [
      { id: 'staff001', name: '工作人员甲', role_id: 1, default_fence_id: 1, role_code: 'STAFF', punch_model: 'FOUR' }
    ],
    rules: [
      { id: 1, role_id: 1, punch_index: 1, start_time: '08:00:00', end_time: '08:40:00', winter_start_time: null, required_fence_id: 1 },
      { id: 2, role_id: 1, punch_index: 2, start_time: '12:00:00', end_time: '12:30:00', winter_start_time: null, required_fence_id: 1 },
      { id: 3, role_id: 1, punch_index: 3, start_time: '14:00:00', end_time: '14:30:00', winter_start_time: null, required_fence_id: 1 },
      { id: 4, role_id: 1, punch_index: 4, start_time: '16:30:00', end_time: '22:00:00', winter_start_time: '17:00:00', required_fence_id: 1 }
    ],
    fences: [{ id: 1, name: '融媒体中心', lat: 26.5668, lng: 107.5173, radius: 300, is_active: 1 }]
  }

  return {
    findUserById: async (userId) => state.users.find((item) => item.id === userId) || null,
    findShiftRulesByRoleId: async (roleId) => state.rules.filter((item) => item.role_id === roleId),
    findFenceById: async (fenceId) => state.fences.find((item) => item.id === fenceId) || null,
    findFenceByName: async (name) => state.fences.find((item) => item.name === name) || null,
    findCheckinBySlot: async (userId, bizDate, punchIndex) =>
      state.checkins.find((item) => item.user_id === userId && item.biz_date === bizDate && item.punch_index === punchIndex) || null,
    findCheckinByIdempotency: async (key) => state.checkins.find((item) => item.idempotency_key === key) || null,
    createCheckin: async (payload) => {
      const id = state.checkins.length + 1
      state.checkins.push({
        id,
        user_id: payload.userId,
        biz_date: payload.bizDate,
        punch_index: payload.punchIndex,
        punched_at: payload.punchedAt,
        late_minutes: payload.lateMinutes,
        idempotency_key: payload.idempotencyKey
      })
      return id
    },
    updateCheckinRecord: async (id, payload) => {
      const idx = state.checkins.findIndex((item) => item.id === id)
      state.checkins[idx] = { ...state.checkins[idx], punched_at: payload.punchedAt, late_minutes: payload.lateMinutes }
    },
    createUploadAudit: async (payload) => state.audios.push(payload),
    listDailyCheckins: async (bizDate) => state.checkins.filter((item) => item.biz_date === bizDate),
    listActiveUsers: async () => state.users,
    listApprovedAbsencesCoveringDate: async (bizDate) =>
      state.absences
        .filter((item) => item.status === 'APPROVED' && item.start_at.slice(0, 10) <= bizDate && item.end_at.slice(0, 10) >= bizDate)
        .map((item) => ({ user_id: item.user_id, type: item.type, start_at: item.start_at, end_at: item.end_at })),
    upsertAbsence: async (record) => {
      const existed = state.absences.find((item) => item.external_id === record.externalId)
      if (existed) {
        Object.assign(existed, {
          user_id: record.userId,
          type: record.type,
          start_at: record.startAt,
          end_at: record.endAt,
          status: record.status
        })
      } else {
        state.absences.push({
          user_id: record.userId,
          type: record.type,
          start_at: record.startAt,
          end_at: record.endAt,
          status: record.status,
          external_id: record.externalId
        })
      }
    }
  }
}

test('离线补传支持幂等键去重', async () => {
  const service = new AttendanceService(createFakeRepository())
  const payload = {
    userId: 'staff001',
    lat: 26.5668,
    lng: 107.5173,
    punchedAt: '2026-05-01T08:10:00',
    isOffline: true,
    idempotencyKey: 'offline-1'
  }
  const first = await service.submitCheckin(payload)
  const second = await service.submitCheckin(payload)
  assert.equal(first.accepted, true)
  assert.equal(second.duplicated, true)
})

test('请假数据并入统计后不计缺卡', async () => {
  const service = new AttendanceService(createFakeRepository())
  await service.ingestAbsences([
    {
      userId: 'staff001',
      type: 'LEAVE',
      startAt: '2026-05-02 00:00:00',
      endAt: '2026-05-02 23:59:59',
      status: 'APPROVED',
      externalId: 'leave-001'
    }
  ])
  const stats = await service.getDailyStats('2026-05-02')
  assert.equal(stats.leave, 1)
  assert.equal(stats.missing, 0)
})
