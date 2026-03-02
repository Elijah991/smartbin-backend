const db = require('./backend/config/database');
const bcrypt = require('./communication/node_modules/bcrypt');

// Load env from communication folder
process.env.DB_HOST = 'localhost';
process.env.DB_USER = 'root';
process.env.DB_PASSWORD = 'root';
process.env.DB_NAME = 'smartbin_database';

const seedDatabase = async () => {
    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash('admin123', 10);
        
        // Insert demo user
        await db.query(`
            INSERT INTO users (name, email, password_hash, role, phone, status, created_at, last_login)
            VALUES (?, ?, ?, ?, ?, ?, NOW(), NULL)
            ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)
        `, ['Admin User', 'admin@smartbin.com', hashedPassword, 'admin', '+1234567890', 'active']);
        
        console.log('✅ Demo user seeded successfully!');
        console.log('   Email: admin@smartbin.com');
        console.log('   Password: admin123');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding database:', error.message);
        process.exit(1);
    }
};

seedDatabase();
