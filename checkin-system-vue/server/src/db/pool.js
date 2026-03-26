const mysql = require('mysql2')

function createPool() {
  return mysql
    .createPool({
      host: process.env.DB_HOST || 'mysql',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '123456',
      database: process.env.DB_NAME || 'checkin',
      waitForConnections: true,
      connectionLimit: 10
    })
    .promise()
}

module.exports = {
  createPool
}
