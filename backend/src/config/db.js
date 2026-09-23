// Connexion a MariaDB via un pool de connexions (mysql2/promise)
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'zomatel_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'zomatel_planning',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // renvoie DATE/DATETIME/TIME en string plutot qu'en objet JS Date
});

module.exports = pool;