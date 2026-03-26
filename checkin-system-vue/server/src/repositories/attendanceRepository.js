class AttendanceRepository {
  constructor(db) {
    this.db = db
  }

  async findUserById(userId) {
    const [rows] = await this.db.query(
      `SELECT u.id, u.name, u.department_id, u.role_id, r.code AS role_code, r.punch_model, r.default_fence_id
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id=? AND u.is_active=1`,
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

  async findFenceById(fenceId) {
    const [rows] = await this.db.query('SELECT id, name, lat, lng, radius, is_active FROM geofences WHERE id=? LIMIT 1', [fenceId])
    return rows[0] || null
  }

  async findFenceByName(name) {
    const [rows] = await this.db.query('SELECT id, name, lat, lng, radius, is_active FROM geofences WHERE name=? LIMIT 1', [name])
    return rows[0] || null
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

  async listActiveUsers() {
    const [rows] = await this.db.query(
      `SELECT u.id, u.name, u.department_id, u.role_id, r.code AS role_code, r.punch_model
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.is_active=1`
    )
    return rows
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
