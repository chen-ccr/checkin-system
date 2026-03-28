class AttendanceRepository {
  constructor(db) {
    this.db = db
  }

  async findUserById(userId) {
    const [rows] = await this.db.query(
      `SELECT u.id, u.name, u.phone, u.department_id, u.role_id, r.code AS role_code, r.punch_model, r.default_fence_id
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id=? AND u.is_active=1`,
      [userId]
    )
    return rows[0] || null
  }

  async findUserByPhone(phone) {
    if (!phone) return null
    const [rows] = await this.db.query(
      `SELECT u.id, u.name, u.phone, u.department_id, u.role_id, r.code AS role_code, r.punch_model, r.default_fence_id
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.phone=? AND u.is_active=1
       LIMIT 1`,
      [String(phone).trim()]
    )
    return rows[0] || null
  }

  async findUserWithRoleById(userId) {
    const [rows] = await this.db.query(
      `SELECT u.id, u.name, u.phone, u.department_id, u.role_id, u.is_active, r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id=?
       LIMIT 1`,
      [userId]
    )
    return rows[0] || null
  }

  async findShiftRulesByRoleId(roleId) {
    const [rows] = await this.db.query(
      `SELECT id, role_id, punch_index, start_time, end_time, winter_start_time, required_fence_id
       FROM role_shift_rules
       WHERE role_id=?
       ORDER BY punch_index ASC`,
      [roleId]
    )
    return rows
  }

  async listShiftRules() {
    const [rows] = await this.db.query(
      `SELECT rsr.id, rsr.role_id, rsr.punch_index, rsr.start_time, rsr.end_time, rsr.winter_start_time, rsr.required_fence_id,
              r.code AS role_code, r.name AS role_name, gf.name AS fence_name
       FROM role_shift_rules rsr
       JOIN roles r ON r.id = rsr.role_id
       LEFT JOIN geofences gf ON gf.id = rsr.required_fence_id
       ORDER BY rsr.role_id ASC, rsr.punch_index ASC`
    )
    return rows
  }

  async findFenceById(fenceId) {
    const [rows] = await this.db.query('SELECT id, name, lat, lng, radius, is_active FROM geofences WHERE id=? LIMIT 1', [fenceId])
    return rows[0] || null
  }

  async findFenceByName(name) {
    const [rows] = await this.db.query('SELECT id, name, lat, lng, radius, is_active FROM geofences WHERE name=? LIMIT 1', [name])
    return rows[0] || null
  }

  async listGeofences() {
    const [rows] = await this.db.query(
      `SELECT id, name, lat, lng, radius, is_active
       FROM geofences
       ORDER BY id ASC`
    )
    return rows
  }

  async findCheckinBySlot(userId, bizDate, punchIndex) {
    const [rows] = await this.db.query(
      'SELECT * FROM checkins WHERE user_id=? AND biz_date=? AND punch_index=? LIMIT 1',
      [userId, bizDate, punchIndex]
    )
    return rows[0] || null
  }

  async findCheckinByIdempotency(idempotencyKey) {
    if (!idempotencyKey) return null
    const [rows] = await this.db.query('SELECT * FROM checkins WHERE idempotency_key=? LIMIT 1', [idempotencyKey])
    return rows[0] || null
  }

  async createCheckin(payload) {
    const [result] = await this.db.query(
      `INSERT INTO checkins
       (user_id, biz_date, punch_index, punched_at, lat, lng, fence_id, distance_meters, status, late_minutes, is_offline, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.userId,
        payload.bizDate,
        payload.punchIndex,
        payload.punchedAt,
        payload.lat,
        payload.lng,
        payload.fenceId,
        payload.distanceMeters,
        payload.status,
        payload.lateMinutes,
        payload.isOffline ? 1 : 0,
        payload.idempotencyKey || null
      ]
    )
    return result.insertId
  }

  async updateCheckinRecord(checkinId, payload) {
    await this.db.query(
      `UPDATE checkins
       SET punched_at=?, lat=?, lng=?, fence_id=?, distance_meters=?, status=?, late_minutes=?, is_offline=?, idempotency_key=?
       WHERE id=?`,
      [
        payload.punchedAt,
        payload.lat,
        payload.lng,
        payload.fenceId,
        payload.distanceMeters,
        payload.status,
        payload.lateMinutes,
        payload.isOffline ? 1 : 0,
        payload.idempotencyKey || null,
        checkinId
      ]
    )
  }

  async createUploadAudit(payload) {
    await this.db.query(
      'INSERT INTO upload_audit_logs (user_id, idempotency_key, source, accepted, reason, payload) VALUES (?, ?, ?, ?, ?, ?)',
      [
        payload.userId,
        payload.idempotencyKey || null,
        payload.source,
        payload.accepted ? 1 : 0,
        payload.reason || null,
        JSON.stringify(payload.payload)
      ]
    )
  }

  async listDailyCheckins(bizDate) {
    const [rows] = await this.db.query(
      `SELECT c.*, u.name AS user_name, u.department_id, r.code AS role_code
       FROM checkins c
       JOIN users u ON u.id = c.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE c.biz_date=?
       ORDER BY c.user_id ASC, c.punch_index ASC`,
      [bizDate]
    )
    return rows
  }

  async listUserCheckins(userId, limit = 30) {
    const [rows] = await this.db.query(
      `SELECT c.id, c.biz_date, c.punch_index, c.punched_at, c.status, c.late_minutes, c.distance_meters, c.is_offline,
              gf.name AS fence_name, rsr.start_time, rsr.end_time
       FROM checkins c
       LEFT JOIN geofences gf ON gf.id = c.fence_id
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN role_shift_rules rsr ON rsr.role_id = u.role_id AND rsr.punch_index = c.punch_index
       WHERE c.user_id=?
       ORDER BY c.punched_at DESC
       LIMIT ?`,
      [userId, Number(limit)]
    )
    return rows
  }

  async listCheckinsByRange(payload) {
    const params = [payload.startDate, payload.endDate]
    const conditions = ['c.biz_date BETWEEN ? AND ?']
    if (payload.departmentId) {
      conditions.push('u.department_id=?')
      params.push(payload.departmentId)
    }
    if (payload.userId) {
      conditions.push('u.id=?')
      params.push(payload.userId)
    }
    const [rows] = await this.db.query(
      `SELECT c.id, c.user_id, c.biz_date, c.punch_index, c.punched_at, c.status, c.late_minutes, c.distance_meters, c.is_offline,
              u.name AS user_name, u.department_id, d.name AS department_name, r.code AS role_code, gf.name AS fence_name
       FROM checkins c
       JOIN users u ON u.id = c.user_id
       JOIN departments d ON d.id = u.department_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN geofences gf ON gf.id = c.fence_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.biz_date DESC, c.user_id ASC, c.punch_index ASC`,
      params
    )
    return rows
  }

  async listActiveUsers() {
    const [rows] = await this.db.query(
      `SELECT u.id, u.name, u.department_id, u.role_id, r.code AS role_code, r.punch_model
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.is_active=1`
    )
    return rows
  }

  async listUsers(payload = {}) {
    const params = []
    const conditions = ['1=1']
    if (typeof payload.departmentId === 'number') {
      conditions.push('u.department_id=?')
      params.push(payload.departmentId)
    }
    if (payload.onlyActive) {
      conditions.push('u.is_active=1')
    }
    const [rows] = await this.db.query(
      `SELECT u.id, u.name, u.nickname, u.phone, u.department_id, d.name AS department_name, u.role_id, r.code AS role_code, r.name AS role_name, u.is_active, u.created_at
       FROM users u
       JOIN departments d ON d.id = u.department_id
       JOIN roles r ON r.id = u.role_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY u.created_at DESC`,
      params
    )
    return rows
  }

  async createUser(payload) {
    await this.db.query(
      `INSERT INTO users (id, name, nickname, phone, department_id, role_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [payload.id, payload.name, payload.nickname || null, payload.phone || null, payload.departmentId, payload.roleId, payload.isActive ? 1 : 0]
    )
  }

  async updateUser(payload) {
    await this.db.query(
      `UPDATE users
       SET name=?, nickname=?, phone=?, department_id=?, role_id=?, is_active=?
       WHERE id=?`,
      [payload.name, payload.nickname || null, payload.phone || null, payload.departmentId, payload.roleId, payload.isActive ? 1 : 0, payload.id]
    )
  }

  async deleteUser(userId) {
    await this.db.query('DELETE FROM users WHERE id=?', [userId])
  }

  async updateUserNickname(userId, nickname) {
    await this.db.query(
      `UPDATE users SET nickname=? WHERE id=?`,
      [nickname, userId]
    )
  }

  async listDepartments() {
    const [rows] = await this.db.query(
      `SELECT id, name
       FROM departments
       ORDER BY id ASC`
    )
    return rows
  }

  async findDepartmentById(id) {
    const [rows] = await this.db.query(
      `SELECT id, name FROM departments WHERE id=? LIMIT 1`,
      [id]
    )
    return rows[0] || null
  }

  async findDepartmentByName(name) {
    const [rows] = await this.db.query(
      `SELECT id, name FROM departments WHERE name=? LIMIT 1`,
      [name]
    )
    return rows[0] || null
  }

  async findRoleByCode(code) {
    const [rows] = await this.db.query(
      `SELECT id, code, name FROM roles WHERE code=? LIMIT 1`,
      [code]
    )
    return rows[0] || null
  }

  async createDepartment(name) {
    const [result] = await this.db.query(
      `INSERT INTO departments (name)
       VALUES (?)`,
      [name]
    )
    return result.insertId
  }

  async listRoles() {
    const [rows] = await this.db.query(
      `SELECT r.id, r.code, r.name, r.punch_model, r.default_fence_id, gf.name AS default_fence_name
       FROM roles r
       LEFT JOIN geofences gf ON gf.id = r.default_fence_id
       ORDER BY r.id ASC`
    )
    return rows
  }

  async createGeofence(payload) {
    await this.db.query(
      `INSERT INTO geofences (name, lat, lng, radius, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [payload.name, payload.lat, payload.lng, payload.radius, payload.isActive ? 1 : 0]
    )
  }

  async updateGeofence(payload) {
    await this.db.query(
      `UPDATE geofences
       SET name=?, lat=?, lng=?, radius=?, is_active=?
       WHERE id=?`,
      [payload.name, payload.lat, payload.lng, payload.radius, payload.isActive ? 1 : 0, payload.id]
    )
  }

  async upsertShiftRule(payload) {
    if (payload.id) {
      await this.db.query(
        `UPDATE role_shift_rules
         SET role_id=?, punch_index=?, start_time=?, end_time=?, winter_start_time=?, required_fence_id=?
         WHERE id=?`,
        [payload.roleId, payload.punchIndex, payload.startTime, payload.endTime, payload.winterStartTime || null, payload.requiredFenceId || null, payload.id]
      )
      return
    }
    await this.db.query(
      `INSERT INTO role_shift_rules (role_id, punch_index, start_time, end_time, winter_start_time, required_fence_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_time=VALUES(start_time), end_time=VALUES(end_time), winter_start_time=VALUES(winter_start_time), required_fence_id=VALUES(required_fence_id)`,
      [payload.roleId, payload.punchIndex, payload.startTime, payload.endTime, payload.winterStartTime || null, payload.requiredFenceId || null]
    )
  }

  async deleteShiftRule(id) {
    await this.db.query('DELETE FROM role_shift_rules WHERE id=?', [id])
  }

  async listApprovedAbsencesCoveringDate(bizDate) {
    const [rows] = await this.db.query(
      `SELECT user_id, type, start_at, end_at
       FROM absences
       WHERE status='APPROVED'
         AND DATE(start_at) <= ?
         AND DATE(end_at) >= ?`,
      [bizDate, bizDate]
    )
    return rows
  }

  async listApprovedAbsencesInRange(startDate, endDate) {
    const [rows] = await this.db.query(
      `SELECT user_id, type, start_at, end_at
       FROM absences
       WHERE status='APPROVED'
         AND DATE(start_at) <= ?
         AND DATE(end_at) >= ?`,
      [endDate, startDate]
    )
    return rows
  }

  async upsertAbsence(record) {
    await this.db.query(
      `INSERT INTO absences (user_id, type, start_at, end_at, status, source, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), type=VALUES(type), start_at=VALUES(start_at), end_at=VALUES(end_at), status=VALUES(status)`,
      [
        record.userId,
        record.type,
        record.startAt,
        record.endAt,
        record.status,
        record.source || 'integration',
        record.externalId || null
      ]
    )
  }

  async getCompanyFence() {
    const [rows] = await this.db.query('SELECT id, name, lat, lng, radius FROM geofences WHERE name=? LIMIT 1', ['融媒体中心'])
    return rows[0] || null
  }

  async updateCompanyFence(payload) {
    await this.db.query(
      `UPDATE geofences
       SET lat=?, lng=?, radius=?
       WHERE id=?`,
      [payload.lat, payload.lng, payload.radius, payload.id]
    )
  }
}

module.exports = AttendanceRepository
