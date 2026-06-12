import Redis from 'ioredis'

// family: 0 enables dual-stack DNS lookup required on Railway's private network.
// Each BullMQ Queue and Worker needs its own connection, so we export a factory
// rather than a shared singleton for those callers.
export function createConnection() {
  const conn = new Redis(process.env.REDIS_URL, {
    family: 0,
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    // Stop retrying after 5 failures — prevents infinite log spam when Redis is absent.
    // Returns null to signal ioredis to give up (emits 'close', not a crash).
    retryStrategy: (times) => {
      if (times >= 5) return null
      return Math.min(times * 500, 3000)
    },
  })
  conn.on('error', (err) => console.warn('[redis] connection error:', err.message))
  return conn
}

let redis = null
try {
  redis = createConnection()
  redis.on('connect', () => console.log('[redis] connected'))
} catch (err) {
  console.warn('[redis] init failed (non-fatal):', err.message)
}

export default redis
