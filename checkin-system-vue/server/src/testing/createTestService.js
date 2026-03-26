const ExcelJS = require('exceljs')

function createTestService() {
  const state = {
    checkins: []
  }
  const repository = {
    findUserWithRoleById: async (userId) => {
      if (userId === 'test123') {
        return { id: 'test123', name: '测试管理员', department_id: 1, role_code: 'ADMIN', is_active: 1 }
      }
      return null
    }
  }
  return {
    repository,
    submitCheckin: async (payload) => {
      const data = {
        recordId: state.checkins.length + 1,
        accepted: true,
        replaced: false,
        status: 'NORMAL',
        lateMinutes: 0,
        bizDate: '2026-05-01',
        punchIndex: payload.punchIndex || 1,
        distanceMeters: 0,
        fenceName: '融媒体中心',
        source: payload.isOffline ? 'OFFLINE' : 'ONLINE'
      }
      state.checkins.push(data)
      return data
    },
    precheckLocation: async () => ({
      punchIndex: 1,
      fenceName: '融媒体中心',
      distanceMeters: 12,
      radius: 300,
      inside: true,
      message: '在围栏范围内，可打卡'
    }),
    getUserTodayPlan: async () => ({ nodes: [{ punchIndex: 1, status: 'PENDING' }] }),
    getUserHistory: async () => ({ records: state.checkins }),
    getDailyStats: async () => ({ total: state.checkins.length }),
    ingestAbsences: async () => ({ accepted: 1 }),
    getAdminBootstrap: async () => ({ users: [] }),
    listUsersForAdmin: async () => [],
    saveUserForAdmin: async () => ({ id: 'staff001' }),
    saveFenceForAdmin: async () => ({ id: 1 }),
    saveShiftRuleForAdmin: async () => ({ id: 1 }),
    getDashboard: async () => ({ records: state.checkins, range: { startDate: '2026-05-01', endDate: '2026-05-01' } }),
    exportDashboard: async () => {
      const workbook = new ExcelJS.Workbook()
      const summarySheet = workbook.addWorksheet('汇总报表')
      const detailSheet = workbook.addWorksheet('明细报表')
      summarySheet.addRow(['指标', '数值'])
      summarySheet.addRow(['应到', 2])
      detailSheet.addRow(['日期', '部门'])
      detailSheet.addRow(['2026-05-01', '融媒体中心'])
      return {
        fileName: 'attendance-2026-05-01-2026-05-01.xlsx',
        content: await workbook.xlsx.writeBuffer()
      }
    }
  }
}

module.exports = {
  createTestService
}
