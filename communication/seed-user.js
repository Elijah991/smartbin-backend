require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const seedDatabase = async () => {
    // Parse DATABASE_URL or construct connection string
    const DATABASE_URL = process.env.DATABASE_URL || 
        `postgres://${process.env.DB_USER || 'user'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'smartbin_database'}`;

    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        const client = await pool.connect();
        
        // Hash the password
        const hashedPassword = await bcrypt.hash('admin123', 10);
        
        console.log('Inserting demo user...');
        // Insert demo user
        await client.query(`
            INSERT INTO users (name, email, password_hash, role, phone, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (email) DO UPDATE SET password_hash = $3, status = 'active'
        `, ['Admin User', 'admin@smartbin.com', hashedPassword, 'admin', '+1234567890', 'active']);
        
        console.log('✅ Demo user seeded successfully!');
        console.log('   Email: admin@smartbin.com');
        console.log('   Password: admin123');
        console.log('   Role: admin');
        
        client.release();
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding database:', error.message);
        process.exit(1);
    }
};

seedDatabase();
