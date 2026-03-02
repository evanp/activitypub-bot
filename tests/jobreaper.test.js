import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

describe('JobReaper', async () => {
  const testQueues = [
    'jobreaper.test.js:1',
    'jobreaper.test.js:2',
    'jobreaper.test.js:3'
  ]
  let connection = null
  let logger = null
  let JobQueue = null
  let JobReaper = null
  let queue = null

  before(async () => {
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, { queues: testQueues })
    logger = new Logger({ level: 'silent' })
  })

  after(async () => {
    await cleanupTestData(connection, { queues: testQueues })
    await connection.close()
  })

  it('can import JobReaper', async () => {
    JobQueue = (await import('../lib/jobqueue.js')).JobQueue
    JobReaper = (await import('../lib/jobreaper.js')).JobReaper
    assert.ok(JobReaper)
  })

  it('can construct a JobReaper', () => {
    queue = new JobQueue(connection, logger)
    const reaper = new JobReaper(queue, logger, { timeout: 60000, interval: 100 })
    assert.ok(reaper)
  })

  it('sweep releases a stalled job', async () => {
    const queueId = 'jobreaper.test.js:1'
    const jobId = await queue.enqueue(queueId, { foo: 'bar' })
    // Manually mark as claimed 2 minutes ago
    const stalledAt = new Date(Date.now() - 2 * 60 * 1000)
    await connection.query(
      'UPDATE job SET claimed_by = ?, claimed_at = ? WHERE job_id = ?',
      { replacements: ['crashed-worker', stalledAt, jobId] }
    )
    // Sweep with a 1-minute timeout — the 2-minute-old claim should be released
    await queue.sweep(60 * 1000)
    // Job should now be available again
    const result = await queue.dequeue(queueId, 'test-runner')
    assert.strictEqual(result.jobId, jobId)
    await queue.complete(jobId, 'test-runner')
  })

  it('sweep does not release a recently claimed job', async () => {
    const queueId = 'jobreaper.test.js:2'
    const jobId = await queue.enqueue(queueId, { foo: 'baz' })
    const { jobId: claimedId } = await queue.dequeue(queueId, 'active-worker')
    assert.strictEqual(claimedId, jobId)
    // Sweep with a 5-minute timeout — a just-claimed job should not be touched
    await queue.sweep(5 * 60 * 1000)
    // Verify it is still claimed in the DB
    const rows = await connection.query(
      'SELECT claimed_by FROM job WHERE job_id = ?',
      { replacements: [jobId] }
    )
    assert.strictEqual(rows[0][0].claimed_by, 'active-worker')
    await queue.complete(jobId, 'active-worker')
  })

  it('reaper automatically reaps stalled jobs on its interval', async () => {
    const queueId = 'jobreaper.test.js:3'
    const jobId = await queue.enqueue(queueId, { foo: 'quux' })
    // Manually mark as stalled
    const stalledAt = new Date(Date.now() - 2 * 60 * 1000)
    await connection.query(
      'UPDATE job SET claimed_by = ?, claimed_at = ? WHERE job_id = ?',
      { replacements: ['crashed-worker', stalledAt, jobId] }
    )
    // Start reaper with short interval
    const reaper = new JobReaper(queue, logger, { timeout: 60 * 1000, interval: 100 })
    reaper.run()
    // Wait long enough for at least one sweep
    await new Promise(resolve => setTimeout(resolve, 300))
    reaper.stop()
    // Job should now be available
    const result = await queue.dequeue(queueId, 'test-runner')
    assert.strictEqual(result.jobId, jobId)
    await queue.complete(jobId, 'test-runner')
  })
})
