-- 考勤系统数据库表结构
-- 导出时间: 2026-03-27

-- 部门表
CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  UNIQUE KEY uk_departments_name(name)
);

-- 围栏表
CREATE TABLE IF NOT EXISTS geofences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  radius INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);

-- 角色表
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  punch_model ENUM('TWO','FOUR') NOT NULL,
  default_fence_id INT NULL,
  UNIQUE KEY uk_roles_code(code),
  CONSTRAINT fk_roles_fence FOREIGN KEY (default_fence_id) REFERENCES geofences(id)
);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  nickname VARCHAR(64) NULL,
  phone VARCHAR(32) NULL,
  department_id INT NOT NULL,
  role_id INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_phone(phone),
  CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- 班次规则表
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
);

-- 请假/出差表
CREATE TABLE IF NOT EXISTS absences (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  type ENUM('LEAVE','BUSINESS_TRIP') NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  status ENUM('APPROVED','REJECTED','PENDING') NOT NULL DEFAULT 'PENDING',
  source VARCHAR(64) NOT NULL DEFAULT 'manual',
  external_id VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_absence_external(source, external_id),
  INDEX idx_absence_user_time(user_id, start_at, end_at)
);

-- 打卡记录表
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
);

-- 上传审计日志表
CREATE TABLE IF NOT EXISTS upload_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(16) NOT NULL,
  accepted TINYINT(1) NOT NULL DEFAULT 1,
  reason VARCHAR(255) NULL,
  payload JSON NOT NULL
);
