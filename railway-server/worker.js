// BullMQ worker process — runs independently of the Express web process.
// Queue registrations and job handlers go here once the queue layer is wired up.
import './lib/redis.js'
import './lib/postgres.js'

console.log('[worker] process started — awaiting queue registration')
