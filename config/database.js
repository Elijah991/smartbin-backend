const { Pool } = require('pg');
require('dotenv').config();

// Parse DATABASE_URL or construct connection string
const DATABASE_URL =
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'user'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'smartbin_database'}`;

// Create connection pool with SSL configuration for Render.com
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Run lightweight migrations on startup
const runMigrations = async () => {
    try {
        const migrateFcmToken = require('../migrations/01_add_fcm_token');
        await migrateFcmToken(pool);
    } catch (error) {
        console.error('❌ Database migrations failed:', error.message);
        // On Render, failing hard here is better than running with a bad schema
        process.exit(1);
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
        console.error('❌ Database initialization failed:', error.message);
        process.exit(1);
    }
};

initDatabase();

module.exports = pool;