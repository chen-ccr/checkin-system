const mysql = require('mysql2')

const pool = mysql.createPool({
  host: 'mysql',
  user: 'root',
  password: '123456',
  database: 'checkin'
})

module.exports = pool.promise()