// Connection to MySQL (a pool reuses connections, so it is fast)
// Works on your own computer and on a cloud host such as Aiven.
require('dotenv').config();
const mysql = require('mysql2/promise');

module.exports = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // Cloud databases need an encrypted connection: set DB_SSL=true
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10
});
