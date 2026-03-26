const jwt = require('jsonwebtoken')
const AppError = require('../errors/AppError')
const errorCodes = require('../constants/errorCodes')

const TEST_MODE = process.env.TEST_MODE === 'true'

function requireAuth(req, _res, next) {
  if (TEST_MODE) {
    req.auth = {
      userId: 'test123',
      userName: '测试用户',
      departmentId: 1,
      role: 'SUPER_ADMIN'
    }
    return next()
  }
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) {
    return next(new AppError(errorCodes.UNAUTHORIZED, '缺少授权令牌', 401))
  }
  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret')
    req.auth = payload
    return next()
  } catch (e) {
    return next(new AppError(errorCodes.UNAUTHORIZED, '授权令牌无效', 401))
  }
}

function requireRole(allowedRoles) {
  return (req, _res, next) => {
    if (TEST_MODE) {
      return next()
    }
    const role = req.auth?.role
    if (!role || !allowedRoles.includes(role)) {
      return next(new AppError(errorCodes.FORBIDDEN, '权限不足', 403))
    }
    return next()
  }
}

module.exports = {
  requireAuth,
  requireRole,
  TEST_MODE
}
