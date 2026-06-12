import { Queue } from 'bullmq'
import { createConnection } from './redis.js'

// The Queue holds one dedicated Redis connection.
// Workers hold their own separate connections (see worker.js).
// Wrapped in try/catch so a missing Redis does not prevent the server from starting.
let instafinancials = null
try {
  instafinancials = new Queue('instafinancials', {
    connection: createConnection(),
    defaultJobOptions: {
      attempts: 4,
      // 'custom' tells BullMQ to call the backoffStrategy registered on the Worker,
      // which adds jitter on top of exponential delay.
      backoff: { type: 'custom' },
      removeOnComplete: { count: 500 },
      removeOnFail:     { count: 100 },
    },
  })
  instafinancials.on('error', (err) => console.warn('[queue:instafinancials] error (non-fatal):', err.message))
} catch (err) {
  console.warn('[queues] instafinancials init failed (non-fatal):', err.message)
}

export { instafinancials }
