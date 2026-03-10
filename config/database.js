const { Pool } = require('pg');
require('dotenv').config();

// Parse DATABASE_URL or construct connection string
const DATABASE_URL = process.env.DATABASE_URL || 
    `postgres://${process.env.DB_USER || 'user'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'smartbin_database'}`;

// Create connection pool with SSL configuration for Render.com
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
const testConnection = async () => {
    try {
        const client = await pool.connect();
        console.log('✅ Database connected successfully');
        client.release();
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        process.exit(1);
    }
};

testConnection();

module.exports = pool;