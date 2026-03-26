const test = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
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
        idempotency_key: payload.idempotencyKey,
        is_offline: payload.isOffline ? 1 : 0,
        distance_meters: payload.distanceMeters
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
    listUsers: async () =>
      state.users.map((item) => ({
        ...item,
        department_id: 1,
        department_name: '融媒体中心',
        role_name: '工作人员',
        is_active: 1
      })),
    listDepartments: async () => [{ id: 1, name: '融媒体中心' }],
    listRoles: async () => [{ id: 1, code: 'STAFF', name: '工作人员', punch_model: 'FOUR' }],
    listGeofences: async () => state.fences,
    listShiftRules: async () => state.rules.map((item) => ({ ...item, role_name: '工作人员' })),
    findUserWithRoleById: async (userId) =>
      state.users.find((item) => item.id === userId)
        ? { id: userId, name: '工作人员甲', department_id: 1, role_code: 'STAFF', is_active: 1 }
        : null,
    createUser: async () => {},
    updateUser: async () => {},
    createGeofence: async () => {},
    updateGeofence: async () => {},
    upsertShiftRule: async () => {},
    listCheckinsByRange: async () =>
      state.checkins.map((item) => ({
        ...item,
        user_name: '工作人员甲',
        department_name: '融媒体中心',
        role_code: 'STAFF',
        is_offline: item.is_offline || 0,
        distance_meters: item.distance_meters || (item.is_offline ? 260 : 10)
      })),
    listApprovedAbsencesInRange: async () => [],
    listUserCheckins: async (userId) => state.checkins.filter((item) => item.user_id === userId),
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

test('H5可查询当日节点并返回历史记录', async () => {
  const service = new AttendanceService(createFakeRepository())
  await service.submitCheckin({
    userId: 'staff001',
    lat: 26.5668,
    lng: 107.5173,
    punchedAt: '2026-05-01T08:10:00'
  })
  const plan = await service.getUserTodayPlan('staff001', '2026-05-01')
  const history = await service.getUserHistory('staff001', 10)
  assert.equal(plan.nodes.length, 4)
  assert.equal(plan.nodes[0].checked, true)
  assert.equal(history.records.length, 1)
})

test('围栏预检可返回偏移与可打卡状态', async () => {
  const service = new AttendanceService(createFakeRepository())
  const result = await service.precheckLocation({
    userId: 'staff001',
    lat: 26.5668,
    lng: 107.5173,
    punchedAt: '2026-05-01T08:10:00'
  })
  assert.equal(result.inside, true)
  assert.equal(result.punchIndex, 1)
})

test('导出报表为双sheet xlsx并高亮异常', async () => {
  const service = new AttendanceService(createFakeRepository())
  await service.submitCheckin({
    userId: 'staff001',
    lat: 26.5668,
    lng: 107.5173,
    punchedAt: '2026-05-01T08:35:00',
    isOffline: true
  })
  const exported = await service.exportDashboard({ role: 'SUPER_ADMIN', departmentId: 1 }, { mode: 'day', date: '2026-05-01' })
  assert.equal(exported.fileName.endsWith('.xlsx'), true)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(exported.content)
  assert.equal(workbook.worksheets.length, 2)
  assert.equal(workbook.getWorksheet('汇总报表').name, '汇总报表')
  const detailSheet = workbook.getWorksheet('明细报表')
  assert.equal(detailSheet.getRow(1).getCell(1).value, '日期')
  assert.equal(detailSheet.getRow(2).getCell(11).value.includes('迟到'), true)
  assert.equal(detailSheet.getRow(2).getCell(11).value.includes('离线上传'), true)
  assert.equal(detailSheet.getRow(2).getCell(11).fill.fgColor.argb, 'FFEF4444')
})
