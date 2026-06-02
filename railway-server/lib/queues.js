import { Queue } from 'bullmq'
import { createConnection } from './redis.js'

// The Queue holds one dedicated Redis connection.
// Workers hold their own separate connections (see worker.js).
export const instafinancials = new Queue('instafinancials', {
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
