import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})

pool.on('error', (err) => console.error('[postgres] idle client error:', err.message))

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brisk_reports (
      cin          TEXT PRIMARY KEY,
      order_id     TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      adapted_data JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

export default pool
