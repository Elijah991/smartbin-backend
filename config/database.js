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

// Run lightweight migrations on startup
const runMigrations = async () => {
    try {
        const migrateFcmToken = require('../migrations/01_add_fcm_token');
        await migrateFcmToken(pool);
    } catch (error) {
        console.error('❌ Database migrations failed:', error.message);
        console.warn('⚠️ Continuing even though migrations failed. Some features may not work.');
        // Continue running so the app can still respond (useful in deploys where DB may be temporarily unavailable)
    }
};

// Test database connection and then run migrations
const initDatabase = async () => {
    try {
        const client = await pool.connect();
        console.log('✅ Database connected successfully');
        client.release();

        await runMigrations();
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        console.warn('⚠️ Continuing without a working database connection. Some features may be unavailable.');
        // Do not exit; allow the service to stay running on platforms like Render.
    }
};

initDatabase();

module.exports = pool;