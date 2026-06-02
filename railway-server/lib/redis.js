import Redis from 'ioredis'

// family: 0 enables dual-stack DNS lookup required on Railway's private network.
// Each BullMQ Queue and Worker needs its own connection, so we export a factory
// rather than a shared singleton for those callers.
export function createConnection() {
  return new Redis(process.env.REDIS_URL, {
    family: 0,
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  })
}

const redis = createConnection()
redis.on('error', (err) => console.error('[redis] connection error:', err.message))
redis.on('connect', () => console.log('[redis] connected'))

export default redis
