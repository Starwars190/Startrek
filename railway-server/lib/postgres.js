import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})

pool.on('error', (err) => console.error('[postgres] idle client error:', err.message))

export default pool
