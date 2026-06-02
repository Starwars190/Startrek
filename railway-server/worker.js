import { Worker, UnrecoverableError } from 'bullmq'
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createConnection } from './lib/redis.js'
import pool, { ensureSchema } from './lib/postgres.js'
import { BRISK_BASE, httpsGetJson, adaptBRiskReport } from './lib/brisk.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR  = join(__dirname, 'cache')

async function processInstaFinancials(job) {
  const { cin } = job.data
  const apiKey  = process.env.INSTAFINANCIALS_API_KEY
  if (!apiKey) throw new UnrecoverableError('INSTAFINANCIALS_API_KEY not configured')

  const headers = {
    'user-key':     apiKey,
    'Accept':       'application/json',
    'Content-Type': 'application/json',
  }

  // Resume check: if a prior attempt already placed an order, reuse its OrderID
  // rather than placing a new (billable) order on every BullMQ retry.
  let orderId
  const { rows } = await pool.query(
    'SELECT order_id FROM brisk_reports WHERE cin = $1',
    [cin]
  )
  if (rows.length > 0 && rows[0].order_id) {
    orderId = rows[0].order_id
    console.log(`[worker] resuming with stored OrderID ${orderId} for ${cin}`)
  } else {
    // Place order
    const orderRes = await fetch(`${BRISK_BASE}/CompanyCIN/${cin}/OrderReport`, {
      method: 'POST',
      headers,
      body: JSON.stringify(['FIN']),
    })
    if (!orderRes.ok) {
      const detail = await orderRes.text()
      if (orderRes.status === 400) throw new UnrecoverableError(`BRisk 400 placing order for ${cin}: ${detail}`)
      throw new Error(`BRisk order failed (${orderRes.status}): ${detail}`)
    }
    const orderJson = await orderRes.json()
    orderId = orderJson?.OrderID ?? orderJson?.Data?.OrderID ?? orderJson?.orderId
    if (!orderId) throw new Error(`No OrderID in BRisk response: ${JSON.stringify(orderJson)}`)

    // Persist OrderID immediately — so any subsequent retry skips this step
    await pool.query(
      `INSERT INTO brisk_reports (cin, order_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (cin) DO UPDATE SET order_id = $2, updated_at = now()`,
      [cin, orderId]
    )
    console.log(`[worker] placed order ${orderId} for ${cin}`)
  }

  // Download report
  const dlRes = await httpsGetJson(`${BRISK_BASE}/OrderID/${orderId}/DownloadReport`, headers, ['FIN'])
  if (!dlRes.ok) {
    const detail = dlRes.text()
    if (dlRes.status === 400) throw new UnrecoverableError(`BRisk 400 downloading ${orderId} for ${cin}: ${detail}`)
    throw new Error(`BRisk download failed (${dlRes.status}): ${detail}`)
  }
  const reportData = dlRes.json()

  // Adapt (field-mapping logic lives in lib/brisk.js — unchanged)
  const adapted = adaptBRiskReport(reportData)

  // Write file cache (matches the path the web process checks first)
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(join(CACHE_DIR, `brisk_${cin}.json`), JSON.stringify(reportData, null, 2))

  // Persist adapted result to Postgres
  await pool.query(
    `INSERT INTO brisk_reports (cin, order_id, status, adapted_data, updated_at)
     VALUES ($1, $2, 'complete', $3, now())
     ON CONFLICT (cin) DO UPDATE
       SET status = 'complete', adapted_data = $3, updated_at = now()`,
    [cin, orderId, JSON.stringify(adapted)]
  )

  return adapted
}

// ---------------------------------------------------------------------------
// Schema + worker startup
// ---------------------------------------------------------------------------
await ensureSchema()
console.log('[worker] schema ready')

const worker = new Worker('instafinancials', processInstaFinancials, {
  connection: createConnection(),
  concurrency: 3,
  settings: {
    // Exponential backoff with ±1 s jitter; attempts 1-4 → ~2 s, ~4 s, ~8 s, ~16 s
    backoffStrategy: (attemptsMade) => {
      const base   = 2000 * Math.pow(2, attemptsMade - 1)
      const jitter = Math.floor(Math.random() * 1000)
      return base + jitter
    },
  },
})

worker.on('completed', (job)       => console.log(`[worker] ${job.id} completed`))
worker.on('failed',    (job, err)  => console.error(`[worker] ${job?.id} failed:`, err.message))

console.log('[worker] instafinancials worker listening')
