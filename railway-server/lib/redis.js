import Redis from 'ioredis'

// family: 0 enables dual-stack DNS lookup required on Railway's private network
const redis = new Redis(process.env.REDIS_URL, {
  family: 0,
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
})

redis.on('error', (err) => console.error('[redis] connection error:', err.message))
redis.on('connect', () => console.log('[redis] connected'))

export default redis
