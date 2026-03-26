const errorCodes = require('../constants/errorCodes')

function notFoundHandler(_req, res) {
  res.status(404).json({
    code: errorCodes.NOT_FOUND,
    message: '接口不存在'
  })
}

function errorHandler(err, _req, res, _next) {
  const status = err.status || 500
  const code = err.code || errorCodes.INTERNAL_ERROR
  res.status(status).json({
    code,
    message: err.message || '服务异常',
    details: err.details || null
  })
}

module.exports = {
  notFoundHandler,
  errorHandler
}
