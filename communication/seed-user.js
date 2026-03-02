require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const seedDatabase = async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
    });

    try {
        const connection = await pool.getConnection();
        
        // Hash the password
        const hashedPassword = await bcrypt.hash('admin123', 10);
        
        console.log('Inserting demo user...');
        // Insert demo user
        await connection.query(`
            INSERT INTO users (name, email, password_hash, role, phone, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), status = 'active'
        `, ['Admin User', 'admin@smartbin.com', hashedPassword, 'admin', '+1234567890', 'active']);
        
        console.log('✅ Demo user seeded successfully!');
        console.log('   Email: admin@smartbin.com');
        console.log('   Password: admin123');
        console.log('   Role: admin');
        
        connection.release();
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding database:', error.message);
        process.exit(1);
    }
};

seedDatabase();
