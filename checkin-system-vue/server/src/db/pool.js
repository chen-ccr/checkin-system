const mysql = require('mysql2')

function createPool() {
  return mysql
    .createPool({
      host: process.env.DB_HOST || '110.42.214.127',
      port: Number(process.env.DB_PORT) || 13306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'hik12345',
      database: process.env.DB_NAME || 'checkin',
      waitForConnections: true,
      connectionLimit: 10
    })
    .promise()
}

module.exports = {
  createPool
}
