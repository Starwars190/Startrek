import express from 'express'
import cors from 'cors'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { adaptBRiskReport } from './lib/brisk.js'
import { instafinancials } from './lib/queues.js'
import pool, { ensureSchema } from './lib/postgres.js'
import { extractFinancials } from './core/extractFinancials.js'
import { normalize } from './core/normalize.js'
import { run } from './core/pipeline.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.options('*', cors())

// No artificial limits — production-grade payload handling
app.use(express.json({ limit: '500mb' }))
app.use(express.urlencoded({ limit: '500mb', extended: true }))

// Generous timeouts for large documents on slow networks
app.use((req, res, next) => {
  req.setTimeout(600000)  // 10 minutes
  res.setTimeout(600000)
  next()
})

app.get('/', (req, res) => {
  res.json({ status: 'FinSight AI Analyzer — online' })
})

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    model: 'claude-sonnet-4-6',
    maxTokens: 16000,
    replica: process.env.RAILWAY_REPLICA_ID || 'single'
  })
})

// ── Claude API wrapper ────────────────────────────────────────────────────────
// Single entry point for all Anthropic calls.  Passed as a dependency to
// extractFinancials so the core module stays free of env/network concerns.

async function callClaude({ system, content, vision = false }) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  }
  // PDF beta header is required only for document-type content blocks
  if (!vision && Array.isArray(content) && content.some(c => c?.type === 'document')) {
    headers['anthropic-beta'] = 'pdfs-2024-09-25'
  }

  const body = { model: 'claude-sonnet-4-6', max_tokens: 16000, messages: [{ role: 'user', content }] }
  if (system) body.system = system

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300_000) // 5 min hard cap

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    })
    const data = await resp.json()
    if (data.error) {
      const msg = data.error.message || JSON.stringify(data.error)
      if (msg.includes('content filtering') || msg.includes('Output blocked')) {
        console.warn('[callClaude] Content filtered:', msg)
        return ''
      }
      throw new Error(msg)
    }
    return data?.content?.[0]?.text || ''
  } finally {
    clearTimeout(timer)
  }
}


app.post('/analyze', async (req, res) => {
  try {
    const {
      mode, extractedText, pageImages, missingHint,
      imageBase64, imageMimeType,
      fileBase64, mimeType, fileName, companyName
    } = req.body

    const upload = { mode, fileBase64, mimeType, extractedText, pageImages, missingHint, imageBase64, imageMimeType }
    const extraction = await extractFinancials(upload, callClaude)

    // Document could not meet quality threshold — return immediately, no files generated
    if (extraction.status === 'review_required') {
      console.warn('[analyze] review_required:', extraction.reasons)
      return res.status(422).json(extraction)
    }

    // Happy path — normalize to canonical unit (INR Lakhs)
    console.log('[analyze] coverage:', extraction.coverage)
    const normalized = normalize(extraction.raw)
    const analysis = normalized.lineItems
    if (normalized.flags.length) console.log('[analyze] normalize flags:', normalized.flags)

    if (companyName && analysis.company_profile) analysis.company_profile.name = companyName
    console.log('[analyze] key_observations count:', analysis.key_observations?.length)
    const { ratiosByYear, warnings, cfmByYear } = run(analysis)
    if (warnings.length) {
      console.warn('[analyze] integrity gate BLOCKED:', warnings.join(' | '))
      return res.status(422).json({
        status: 'review_required',
        stage: 'validate',
        reasons: warnings,
        warnings: normalized.flags,
        error: warnings[0],
        partial: analysis,
      })
    }
    return res.status(200).json({
      success: true, analysis, ratiosByYear, cfmByYear, mode, format: extraction.format,
      warnings: normalized.flags,
    })

  } catch (err) {
    console.error('[analyze] ERROR:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /fetch-mca/:cin — check caches, then enqueue async BRisk job
// ---------------------------------------------------------------------------
const CACHE_DIR = join(__dirname, 'cache')

app.get('/fetch-mca/:cin', async (req, res) => {
  const { cin } = req.params
  if (!cin || !/^[A-Z0-9]{21}$/.test(cin)) {
    return res.status(400).json({ error: 'Invalid CIN format' })
  }
  if (!process.env.INSTAFINANCIALS_API_KEY) {
    return res.status(500).json({ error: 'INSTAFINANCIALS_API_KEY not configured on server' })
  }

  // 1. File cache hit — adapt inline and return immediately (no queue needed)
  const cachePath = join(CACHE_DIR, `brisk_${cin}.json`)
  if (existsSync(cachePath)) {
    try {
      const adapted = adaptBRiskReport(JSON.parse(readFileSync(cachePath, 'utf8')))
      return res.json(adapted)
    } catch (err) {
      console.warn(`[fetch-mca] cache read failed for ${cin}:`, err.message)
    }
  }

  // 2. Postgres completed-report hit
  try {
    const { rows } = await pool.query(
      'SELECT adapted_data FROM brisk_reports WHERE cin = $1 AND status = $2',
      [cin, 'complete']
    )
    if (rows.length > 0 && rows[0].adapted_data) {
      return res.json(rows[0].adapted_data)
    }
  } catch (err) {
    console.warn('[fetch-mca] Postgres check failed:', err.message)
  }

  // 3. Enqueue — jobId deduplicates so double-clicks collapse to one job
  if (!instafinancials) {
    return res.status(503).json({ error: 'Queue unavailable — Redis not connected' })
  }
  try {
    const job = await instafinancials.add('fetch-brisk', { cin }, { jobId: `brisk:${cin}` })
    return res.status(202).json({ jobId: job.id, status: 'queued' })
  } catch (err) {
    console.error('[fetch-mca] enqueue failed:', err.message)
    return res.status(503).json({ error: 'Queue unavailable' })
  }
})

// ---------------------------------------------------------------------------
// GET /jobs/:id — poll job state; returns result payload when complete
// ---------------------------------------------------------------------------
app.get('/jobs/:id', async (req, res) => {
  if (!instafinancials) return res.status(503).json({ error: 'Queue unavailable — Redis not connected' })
  try {
    const job = await instafinancials.getJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const state = await job.getState()
    const response = { id: job.id, state, progress: job.progress }
    if (state === 'completed') response.result    = job.returnvalue
    if (state === 'failed')    response.failedReason = job.failedReason
    return res.json(response)
  } catch (err) {
    console.error('[jobs] getJob failed:', err.message)
    return res.status(503).json({ error: 'Queue unavailable' })
  }
})

ensureSchema().catch(err => console.error('[postgres] schema error:', err.message))

const server = app.listen(process.env.PORT || 3001, '0.0.0.0', () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`)
})

// Production-grade server timeouts
server.timeout = 600000           // 10 minutes
server.keepAliveTimeout = 600000  // 10 minutes
server.headersTimeout = 605000    // 10 minutes 5 seconds
