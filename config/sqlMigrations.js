const fs = require('fs').promises;
const path = require('path');

/**
 * Ensures migrations_log exists, then runs any *.sql files in /migrations
 * that are not yet recorded. Safe for Render (no manual psql).
 */
async function runSqlMigrations(pool) {
  const migrationsDir = path.join(__dirname, '..', 'migrations');

  let entries;
  try {
    entries = await fs.readdir(migrationsDir);
  } catch (err) {
    console.warn('⚠️ Could not read migrations folder:', err.message);
    return;
  }

  const sqlFiles = entries.filter((f) => f.endsWith('.sql')).sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations_log (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      run_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  for (const filename of sqlFiles) {
    const applied = await pool.query(
      'SELECT 1 FROM migrations_log WHERE filename = $1',
      [filename]
    );
    if (applied.rows.length > 0) {
      console.log(`ℹ️ Migration skipped (already applied): ${filename}`);
      continue;
    }

    const fullPath = path.join(migrationsDir, filename);
    const sql = (await fs.readFile(fullPath, 'utf8')).trim();
    if (!sql) {
      console.warn(`⚠️ Empty SQL migration: ${filename}`);
      await pool.query('INSERT INTO migrations_log (filename) VALUES ($1)', [
        filename,
      ]);
      continue;
    }

    console.log(`⚙️ Running SQL migration: ${filename}...`);
    await pool.query(sql);
    await pool.query('INSERT INTO migrations_log (filename) VALUES ($1)', [
      filename,
    ]);

    const numMatch = filename.match(/^(\d+)/);
    const label = numMatch ? numMatch[1] : filename.replace(/\.sql$/i, '');
    console.log(`✅ Migration ${label} successful`);
  }
}

module.exports = { runSqlMigrations };
