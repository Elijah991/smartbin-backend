const run = async (db) => {
    try {
        // Check if the fcm_token column already exists
        const checkQuery = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users' 
              AND column_name = 'fcm_token'
        `;

        const result = await db.query(checkQuery);
        const columns = Array.isArray(result.rows) ? result.rows : [];

        if (columns.length === 0) {
            console.log('⚙️ Migration: Adding fcm_token column to users table...');
            await db.query('ALTER TABLE users ADD COLUMN fcm_token TEXT;');
            console.log('✅ Migration completed: fcm_token column added.');
        } else {
            console.log('ℹ️ Migration skipped: fcm_token column already exists.');
        }
    } catch (error) {
        console.error('❌ Migration 01_add_fcm_token failed:', error.message);
        throw error;
    }
};

module.exports = run;

