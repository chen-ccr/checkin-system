const { createPool } = require('./src/db/pool')
const { ROLE_CODES, PUNCH_MODEL, ABSENCE_TYPE, ABSENCE_STATUS } = require('./src/constants/domain')

function formatDateTime(value) {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  const hh = String(value.getHours()).padStart(2, '0')
  const mm = String(value.getMinutes()).padStart(2, '0')
  const ss = String(value.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

async function generateTestData() {
  const db = createPool()
  console.log('开始生成测试数据...')

  try {
    const [users] = await db.query('SELECT u.id, u.name, u.role_id, r.default_fence_id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.is_active=1')
    const [rules] = await db.query('SELECT role_id, punch_index, start_time, end_time, required_fence_id FROM role_shift_rules ORDER BY role_id, punch_index')
    const [fences] = await db.query('SELECT id, name, lat, lng FROM geofences')
    
    const ruleMap = rules.reduce((acc, item) => {
      if (!acc[item.role_id]) acc[item.role_id] = []
      acc[item.role_id].push(item)
      return acc
    }, {})
    
    const fenceMap = fences.reduce((acc, item) => {
      acc[item.id] = item
      return acc
    }, {})

    const now = new Date()
    const daysToGenerate = 30

    console.log(`为 ${users.length} 个用户生成 ${daysToGenerate} 天的打卡数据...`)

    for (let dayOffset = 0; dayOffset < daysToGenerate; dayOffset++) {
      const base = new Date(now)
      base.setDate(now.getDate() - dayOffset)
      const bizDate = formatDateTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0)).slice(0, 10)
      
      for (const user of users) {
        const userRules = ruleMap[user.role_id] || []
        
        for (const rule of userRules) {
          const [h, m, s] = String(rule.start_time).split(':').map(Number)
          
          const randomVariance = Math.floor(Math.random() * 10) - 5
          const isLate = Math.random() < 0.2 && rule.punch_index === 1
          const lateMinutes = isLate ? Math.floor(Math.random() * 30) + 5 : 0
          const status = isLate ? 'LATE' : 'NORMAL'
          
          const punchedAt = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m + (isLate ? lateMinutes : randomVariance), s || 0)
          
          const fenceId = rule.required_fence_id || user.default_fence_id || 1
          const fence = fenceMap[fenceId]
          
          const distanceMeters = Math.floor(Math.random() * 150) + 10
          const lat = fence ? fence.lat + (Math.random() - 0.5) * 0.01 : 26.5668
          const lng = fence ? fence.lng + (Math.random() - 0.5) * 0.01 : 107.5173
          
          const isOffline = Math.random() < 0.1
          
          try {
            await db.query(
              `INSERT INTO checkins
               (user_id, biz_date, punch_index, punched_at, lat, lng, fence_id, distance_meters, status, late_minutes, is_offline, idempotency_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE punched_at=VALUES(punched_at), status=VALUES(status), late_minutes=VALUES(late_minutes), is_offline=VALUES(is_offline)`,
              [
                user.id,
                bizDate,
                rule.punch_index,
                formatDateTime(punchedAt),
                lat,
                lng,
                fenceId,
                distanceMeters,
                status,
                lateMinutes,
                isOffline ? 1 : 0,
                `${user.id}-${bizDate}-${rule.punch_index}`
              ]
            )
          } catch (e) {
            console.log(`跳过 ${user.id} ${bizDate} ${rule.punch_index}: 已存在`)
          }
        }
      }
      
      if (dayOffset % 7 === 0 && dayOffset > 0) {
        const randomUser = users[Math.floor(Math.random() * users.length)]
        const leaveStart = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1, 0, 0, 0)
        const leaveEnd = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59)
        
        try {
          await db.query(
            `INSERT INTO absences (user_id, type, start_at, end_at, status, source, external_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE status=VALUES(status), start_at=VALUES(start_at), end_at=VALUES(end_at)`,
            [randomUser.id, ABSENCE_TYPE.LEAVE, formatDateTime(leaveStart), formatDateTime(leaveEnd), ABSENCE_STATUS.APPROVED, 'test-data', `test-leave-${dayOffset}`]
          )
        } catch (e) {
        }
      }
    }

    console.log('测试数据生成完成！')
    
    const [checkinCount] = await db.query('SELECT COUNT(*) AS total FROM checkins')
    const [absenceCount] = await db.query('SELECT COUNT(*) AS total FROM absences')
    console.log(`总计打卡记录: ${checkinCount[0].total}`)
    console.log(`总计请假记录: ${absenceCount[0].total}`)

  } catch (err) {
    console.error('生成测试数据失败:', err)
  } finally {
    await db.end()
  }
}

generateTestData()
