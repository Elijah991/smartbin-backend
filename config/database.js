const { Pool } = require('pg');
require('dotenv').config();

// Parse DATABASE_URL or construct connection string
// If DATABASE_URL is invalid or contains a placeholder host (e.g. 'base'), fall back to a safe default.
const rawDatabaseUrl = process.env.DATABASE_URL;
let DATABASE_URL;

if (rawDatabaseUrl) {
  try {
    const parsed = new URL(rawDatabaseUrl);
    const host = parsed.hostname;

    if (!host || host === 'base') {
      throw new Error(`Invalid host detected in DATABASE_URL: ${host}`);
    }

    DATABASE_URL = rawDatabaseUrl;
  } catch (err) {
    console.warn('⚠️ DATABASE_URL is invalid; falling back to individual DB settings:', err.message);
  }
}

if (!DATABASE_URL) {
  DATABASE_URL = `postgres://${process.env.DB_USER || 'user'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'smartbin_database'}`;
}

// Create connection pool. Use SSL by default for Render, but allow disabling when the server does not support SSL.
const useSsl = process.env.DB_SSL !== 'false' && process.env.NODE_ENV === 'production';

let pool;
try {
  const url = new URL(DATABASE_URL);
  const sslConfig = useSsl ? { rejectUnauthorized: false } : false;

  const passwordValue = url.password || '';
  console.log('📡 Database connection config:', {
    host: url.hostname,
    port: Number(url.port) || 5432,
    user: url.username,
    passwordType: typeof passwordValue,
    passwordLength: passwordValue.length,
    database: (url.pathname || '').replace(/^\//, ''),
    ssl: useSsl
  });

  pool = new Pool({
    host: url.hostname,
    port: Number(url.port) || 5432,
    user: url.username,
    password: passwordValue,
    database: (url.pathname || '').replace(/^\//, ''),
    ssl: sslConfig
  });
} catch (err) {
  console.warn('⚠️ Failed to parse DATABASE_URL, falling back to environment variables:', err.message);
    const fallbackConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'user',
      password: String(process.env.DB_PASSWORD || ''),
      database: process.env.DB_NAME || 'smartbin_database',
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    };
    console.log('📡 Database connection config (fallback):', {
      ...fallbackConfig,
      password: fallbackConfig.password ? '***' : '(empty)'
    });
    pool = new Pool(fallbackConfig);
  }

const { runSqlMigrations } = require('./sqlMigrations');

/**
 * Connect, run SQL migrations from /migrations/*.sql (tracked in migrations_log),
 * then the legacy JS migration for fcm_token. Must complete before HTTP listens.
 * @throws {Error} if the database is unreachable or any migration fails
 */
async function ensureMigrationsComplete() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('✅ Database connected successfully');
  } finally {
    client.release();
  }

  await runSqlMigrations(pool);

  const migrateFcmToken = require('../migrations/01_add_fcm_token');
  await migrateFcmToken(pool);
}

pool.ensureMigrationsComplete = ensureMigrationsComplete;

module.exports = pool;