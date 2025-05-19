//
//  db.js
//  
//
//  Created by Brent Lane on 5/9/25.
//


// backend/config/db.js
const { Pool } = require('pg');
require('dotenv').config(); // Ensure this is at the top if not loading dotenv in server.js first for db config

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "5432"), // pg needs port as a number
});

// Test the connection (optional, but good for verification)
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to PostgreSQL database:', err.stack);
  } else {
    console.log('Successfully connected to PostgreSQL database at:', res.rows[0].now);
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool, // Export pool if you need direct access for transactions etc.
};
