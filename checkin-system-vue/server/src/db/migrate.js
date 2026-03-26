const { ROLE_CODES, PUNCH_MODEL, ABSENCE_TYPE, ABSENCE_STATUS } = require('../constants/domain')

async function tableExists(db, tableName) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  )
  return Number(rows[0].total) > 0
}

async function hasColumn(db, tableName, columnName) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  )
  return Number(rows[0].total) > 0
}

async function migrate(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      UNIQUE KEY uk_departments_name(name)
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS geofences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      lat DOUBLE NOT NULL,
      lng DOUBLE NOT NULL,
      radius INT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(32) NOT NULL,
      name VARCHAR(64) NOT NULL,
      punch_model ENUM('${PUNCH_MODEL.TWO}','${PUNCH_MODEL.FOUR}') NOT NULL,
      default_fence_id INT NULL,
      UNIQUE KEY uk_roles_code(code),
      CONSTRAINT fk_roles_fence FOREIGN KEY (default_fence_id) REFERENCES geofences(id)
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      department_id INT NOT NULL,
      role_id INT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id),
      CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS role_shift_rules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      role_id INT NOT NULL,
      punch_index TINYINT NOT NULL,
      start_time VARCHAR(8) NOT NULL,
      end_time VARCHAR(8) NOT NULL,
      winter_start_time VARCHAR(8) NULL,
      required_fence_id INT NULL,
      UNIQUE KEY uk_role_shift(role_id, punch_index),
      CONSTRAINT fk_shift_role FOREIGN KEY (role_id) REFERENCES roles(id),
      CONSTRAINT fk_shift_fence FOREIGN KEY (required_fence_id) REFERENCES geofences(id)
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS absences (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      type ENUM('${ABSENCE_TYPE.LEAVE}','${ABSENCE_TYPE.BUSINESS_TRIP}') NOT NULL,
      start_at DATETIME NOT NULL,
      end_at DATETIME NOT NULL,
      status ENUM('${ABSENCE_STATUS.APPROVED}','${ABSENCE_STATUS.REJECTED}','${ABSENCE_STATUS.PENDING}') NOT NULL DEFAULT '${ABSENCE_STATUS.PENDING}',
      source VARCHAR(64) NOT NULL DEFAULT 'manual',
      external_id VARCHAR(128) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_absence_external(source, external_id),
      INDEX idx_absence_user_time(user_id, start_at, end_at)
    )
  `)

  const checkinsExists = await tableExists(db, 'checkins')
  if (checkinsExists) {
    const hasBizDate = await hasColumn(db, 'checkins', 'biz_date')
    const hasLegacyUserId = await hasColumn(db, 'checkins', 'userId')
    if (!hasBizDate && hasLegacyUserId) {
      const legacyName = `checkins_legacy_${Date.now()}`
      await db.query(`RENAME TABLE checkins TO ${legacyName}`)
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS checkins (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      biz_date DATE NOT NULL,
      punch_index TINYINT NOT NULL,
      punched_at DATETIME NOT NULL,
      lat DOUBLE NOT NULL,
      lng DOUBLE NOT NULL,
      fence_id INT NULL,
      distance_meters INT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL,
      late_minutes INT NOT NULL DEFAULT 0,
      is_offline TINYINT(1) NOT NULL DEFAULT 0,
      idempotency_key VARCHAR(128) NULL,
      replaced_by BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_checkin_user_slot(user_id, biz_date, punch_index),
      UNIQUE KEY uk_checkin_idempotency(idempotency_key),
      INDEX idx_checkin_user_date(user_id, biz_date),
      CONSTRAINT fk_checkin_fence FOREIGN KEY (fence_id) REFERENCES geofences(id),
      CONSTRAINT fk_checkin_replaced FOREIGN KEY (replaced_by) REFERENCES checkins(id)
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS upload_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      idempotency_key VARCHAR(128) NULL,
      received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source VARCHAR(16) NOT NULL,
      accepted TINYINT(1) NOT NULL DEFAULT 1,
      reason VARCHAR(255) NULL,
      payload JSON NOT NULL
    )
  `)

  const [departmentRows] = await db.query('SELECT id FROM departments WHERE name=? LIMIT 1', ['融媒体中心'])
  if (departmentRows.length === 0) {
    await db.query('INSERT INTO departments (name) VALUES (?)', ['融媒体中心'])
  }
  const [finalDepartmentRows] = await db.query('SELECT id FROM departments WHERE name=? LIMIT 1', ['融媒体中心'])
  const defaultDepartmentId = finalDepartmentRows[0].id

  const [fenceRows] = await db.query('SELECT id, name FROM geofences')
  if (!fenceRows.find((item) => item.name === '融媒体中心')) {
    await db.query(
      'INSERT INTO geofences (name, lat, lng, radius) VALUES (?, ?, ?, ?)',
      ['融媒体中心', 26.5668, 107.5173, 300]
    )
  }
  if (!fenceRows.find((item) => item.name === '雷公山')) {
    await db.query(
      'INSERT INTO geofences (name, lat, lng, radius) VALUES (?, ?, ?, ?)',
      ['雷公山', 26.3882, 108.1888, 500]
    )
  }

  const [fences] = await db.query('SELECT id, name FROM geofences')
  const fenceByName = fences.reduce((acc, item) => {
    acc[item.name] = item.id
    return acc
  }, {})

  const roleSeeds = [
    [ROLE_CODES.ADMIN, '行政', PUNCH_MODEL.TWO, fenceByName['融媒体中心']],
    [ROLE_CODES.STAFF, '工作人员', PUNCH_MODEL.FOUR, fenceByName['融媒体中心']],
    [ROLE_CODES.DIRECTOR, '导播', PUNCH_MODEL.TWO, fenceByName['融媒体中心']],
    [ROLE_CODES.PRODUCER, '制片', PUNCH_MODEL.TWO, fenceByName['融媒体中心']],
    [ROLE_CODES.CAMERAMAN, '摄像', PUNCH_MODEL.TWO, fenceByName['融媒体中心']],
    [ROLE_CODES.TRANSMISSION, '传输发射', PUNCH_MODEL.TWO, fenceByName['雷公山']],
    [ROLE_CODES.EDITOR, '后期', PUNCH_MODEL.TWO, fenceByName['融媒体中心']],
    [ROLE_CODES.DRIVER, '驾驶员', PUNCH_MODEL.TWO, fenceByName['融媒体中心']]
  ]

  for (const role of roleSeeds) {
    await db.query(
      'INSERT INTO roles (code, name, punch_model, default_fence_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), punch_model=VALUES(punch_model), default_fence_id=VALUES(default_fence_id)',
      role
    )
  }

  const [roles] = await db.query('SELECT id, code FROM roles')
  const roleMap = roles.reduce((acc, item) => {
    acc[item.code] = item.id
    return acc
  }, {})

  const shiftSeeds = [
    [ROLE_CODES.ADMIN, 1, '08:30:00', '09:05:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.ADMIN, 2, '17:00:00', '22:00:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.STAFF, 1, '08:00:00', '08:35:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.STAFF, 2, '12:00:00', '12:30:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.STAFF, 3, '14:00:00', '14:30:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.STAFF, 4, '16:30:00', '22:00:00', '17:00:00', fenceByName['融媒体中心']],
    [ROLE_CODES.DIRECTOR, 1, '07:30:00', '08:10:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.DIRECTOR, 2, '22:00:00', '23:59:59', null, fenceByName['融媒体中心']],
    [ROLE_CODES.PRODUCER, 1, '08:00:00', '08:30:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.PRODUCER, 2, '17:00:00', '21:00:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.CAMERAMAN, 1, '08:00:00', '08:30:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.CAMERAMAN, 2, '18:00:00', '23:59:59', null, fenceByName['融媒体中心']],
    [ROLE_CODES.TRANSMISSION, 1, '08:00:00', '08:30:00', null, fenceByName['雷公山']],
    [ROLE_CODES.TRANSMISSION, 2, '23:30:00', '23:59:59', null, fenceByName['雷公山']],
    [ROLE_CODES.EDITOR, 1, '09:00:00', '09:30:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.EDITOR, 2, '18:00:00', '22:00:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.DRIVER, 1, '07:30:00', '08:30:00', null, fenceByName['融媒体中心']],
    [ROLE_CODES.DRIVER, 2, '17:30:00', '22:00:00', null, fenceByName['融媒体中心']]
  ]

  for (const [roleCode, punchIndex, startTime, endTime, winterStartTime, requiredFenceId] of shiftSeeds) {
    await db.query(
      `INSERT INTO role_shift_rules (role_id, punch_index, start_time, end_time, winter_start_time, required_fence_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_time=VALUES(start_time), end_time=VALUES(end_time), winter_start_time=VALUES(winter_start_time), required_fence_id=VALUES(required_fence_id)`,
      [roleMap[roleCode], punchIndex, startTime, endTime, winterStartTime, requiredFenceId]
    )
  }

  const userSeeds = [
    ['test123', '测试用户', defaultDepartmentId, roleMap[ROLE_CODES.ADMIN]],
    ['staff001', '工作人员甲', defaultDepartmentId, roleMap[ROLE_CODES.STAFF]],
    ['trans001', '传输值机甲', defaultDepartmentId, roleMap[ROLE_CODES.TRANSMISSION]]
  ]

  for (const user of userSeeds) {
    await db.query(
      'INSERT INTO users (id, name, department_id, role_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), department_id=VALUES(department_id), role_id=VALUES(role_id)',
      user
    )
  }
}

module.exports = {
  migrate
}
