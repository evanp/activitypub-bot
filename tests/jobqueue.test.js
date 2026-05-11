import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const JOB_RUNNER_ID = 'jobqueue.test.js'

describe('JobQueue', async () => {
  const testQueues = [...Array(16).keys()].map(i => `jobqueue.test.js:${i}`)
  let connection = null
  let logger = null
  let JobQueue = null
  let queue = null
  let jobId = null
  let payload = null

  before(async () => {
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, { queues: testQueues })
    logger = new Logger({
      level: 'silent'
    })
  })

  after(async () => {
    await cleanupTestData(connection, { queues: testQueues })
    await connection.close()
  })

  it('import works', async () => {
    JobQueue = (await import('../lib/jobqueue.js')).JobQueue
    assert.ok(JobQueue)
  })

  it('constructor works', () => {
    queue = new JobQueue(connection, logger)
    assert.ok(queue)
  })

  it('can enqueue', async () => {
    const queueId = 'jobqueue.test.js:1'
    jobId = await queue.enqueue(queueId, { addends: [2, 2] })
    assert.ok(jobId)
  })

  it('can dequeue', async () => {
    const queueId = 'jobqueue.test.js:1'
    const result = await queue.dequeue(queueId, JOB_RUNNER_ID);
    ({ jobId, payload } = result)
    assert.ok(jobId)
    assert.ok(payload)
    assert.ok(payload.addends)
    assert.strictEqual(payload.addends[0], 2)
    assert.strictEqual(payload.addends[1], 2)
  })

  it('can complete', async () => {
    // const sum = payload.addends[0] + payload.addends[1]
    await queue.complete(jobId, JOB_RUNNER_ID)
  })

  it('can release', async () => {
    const queueId = 'jobqueue.test.js:2'
    await queue.enqueue(queueId, { factors: [2, 2] })
    const job2 = await queue.dequeue(queueId, JOB_RUNNER_ID)
    await queue.release(job2.jobId, JOB_RUNNER_ID)
    const job3 = await queue.dequeue(queueId, JOB_RUNNER_ID)
    assert.equal(job3.jobId, job2.jobId)
  })

  it('can dequeue before enqueue', async () => {
    const queueId = 'jobqueue.test.js:3'
    let enqueued
    setTimeout(() => {
      queue.enqueue(queueId, { name: 'foo' }).then((v) => { enqueued = v })
    }, 100)
    const job = await queue.dequeue(queueId, JOB_RUNNER_ID)
    assert.equal(job.jobId, enqueued)
  })

  it('can tell when the queue is idle', async () => {
    const queueId = 'jobqueue.test.js:4'
    await queue.enqueue(queueId, { foo: 'bar' })
    await queue.enqueue(queueId, { foo: 'baz' })
    await queue.enqueue(queueId, { foo: 'quux' })
    setTimeout(() => {
      queue.dequeue(queueId, JOB_RUNNER_ID)
        .then((job) => queue.complete(job.jobId, JOB_RUNNER_ID))
        .then()
      queue.dequeue(queueId, JOB_RUNNER_ID)
        .then((job) => queue.complete(job.jobId, JOB_RUNNER_ID))
        .then()
      queue.dequeue(queueId, JOB_RUNNER_ID)
        .then((job) => queue.complete(job.jobId, JOB_RUNNER_ID))
        .then()
    }, 100)
    await queue.onIdle(queueId)
    assert.ok(true)
  })

  it('can tell when an untouched queue is idle', async () => {
    const queueId = 'jobqueue.test.js:5'
    await queue.onIdle(queueId)
    assert.ok(true)
  })

  it('can retry a job after an amount of time', async () => {
    const queueId = 'jobqueue.test.js:6'
    const delay = 1000
    await queue.enqueue(queueId, { foo: 'bar' })
    const { jobId } = await queue.dequeue(queueId, JOB_RUNNER_ID)
    const startTime = Date.now()
    await queue.retryAfter(jobId, JOB_RUNNER_ID, delay)
    const res = await queue.dequeue(queueId, JOB_RUNNER_ID)
    const endTime = Date.now()
    assert.strictEqual(res.jobId, jobId)
    assert.ok(endTime - startTime >= delay)
  })

  it('can abort a queue server', async () => {
    const queueId = 'jobqueue.test.js:7'
    setTimeout(() => {
      queue.abort()
    }, 100)
    try {
      await queue.dequeue(queueId, JOB_RUNNER_ID)
    } catch (err) {
    }
    assert.ok(true)
  })

  it('can fail a job', async () => {
    const queueId = 'jobqueue.test.js:8'
    await queue.enqueue(queueId, { addends: [2, 2] })
    const { jobId } = await queue.dequeue(queueId, JOB_RUNNER_ID)
    await queue.fail(jobId, JOB_RUNNER_ID)
    assert.ok(true)
  })

  it('retryAfter() persists lastError to job.last_error', async () => {
    const queueId = 'jobqueue.test.js:9'
    const lastError = 'simulated 503 from remote'
    await queue.enqueue(queueId, { foo: 'bar' })
    const { jobId } = await queue.dequeue(queueId, JOB_RUNNER_ID)
    await queue.retryAfter(jobId, JOB_RUNNER_ID, 1000, lastError)

    const [rows] = await connection.query(
      'SELECT last_error FROM job WHERE job_id = ?',
      { replacements: [jobId] }
    )
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].last_error, lastError)
  })

  it('fail() persists lastError to failed_job.last_error', async () => {
    const queueId = 'jobqueue.test.js:10'
    const lastError = 'permanent: invalid signature'
    await queue.enqueue(queueId, { foo: 'bar' })
    const { jobId } = await queue.dequeue(queueId, JOB_RUNNER_ID)
    await queue.fail(jobId, JOB_RUNNER_ID, lastError)

    const [rows] = await connection.query(
      'SELECT last_error FROM failed_job WHERE job_id = ?',
      { replacements: [jobId] }
    )
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].last_error, lastError)
  })

  it('retryAfter() and fail() work without a lastError argument', async () => {
    const retryQueueId = 'jobqueue.test.js:11'
    await queue.enqueue(retryQueueId, { foo: 'bar' })
    const retryJob = await queue.dequeue(retryQueueId, JOB_RUNNER_ID)
    await queue.retryAfter(retryJob.jobId, JOB_RUNNER_ID, 1000)
    const [retryRows] = await connection.query(
      'SELECT last_error FROM job WHERE job_id = ?',
      { replacements: [retryJob.jobId] }
    )
    assert.strictEqual(retryRows.length, 1)
    assert.strictEqual(retryRows[0].last_error, null)

    const failQueueId = 'jobqueue.test.js:12'
    await queue.enqueue(failQueueId, { foo: 'bar' })
    const failJob = await queue.dequeue(failQueueId, JOB_RUNNER_ID)
    await queue.fail(failJob.jobId, JOB_RUNNER_ID)
    const [failRows] = await connection.query(
      'SELECT last_error FROM failed_job WHERE job_id = ?',
      { replacements: [failJob.jobId] }
    )
    assert.strictEqual(failRows.length, 1)
    assert.strictEqual(failRows[0].last_error, null)
  })

  it('a subsequent retryAfter() overwrites the previous lastError on the same job', async () => {
    // Use a fresh JobQueue so the abort signal from the earlier abort test
    // doesn't poison our second dequeue (which has to wait for retry_after).
    const localQueue = new JobQueue(connection, logger)
    const queueId = 'jobqueue.test.js:1'
    await localQueue.enqueue(queueId, { foo: 'bar' })
    let result = await localQueue.dequeue(queueId, JOB_RUNNER_ID)
    await localQueue.retryAfter(result.jobId, JOB_RUNNER_ID, 1, 'first error')
    result = await localQueue.dequeue(queueId, JOB_RUNNER_ID)
    await localQueue.retryAfter(result.jobId, JOB_RUNNER_ID, 1, 'second error')

    const [rows] = await connection.query(
      'SELECT last_error FROM job WHERE job_id = ?',
      { replacements: [result.jobId] }
    )
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].last_error, 'second error')
  })

  // The following three tests cover the sanity-cap on `delay` in retryAfter().
  // We don't pin a specific cap value — the contract is just "do not let an
  // invalid delay produce an Invalid Date in the SQL parameter." The
  // implementation can clamp to any sane maximum, or reject, as long as the
  // resulting retry_after column is a valid finite timestamp (or NULL).

  async function assertRetryAfterIsValid (jobId, label) {
    const [rows] = await connection.query(
      'SELECT retry_after FROM job WHERE job_id = ?',
      { replacements: [jobId] }
    )
    assert.strictEqual(rows.length, 1, `${label}: expected job row`)
    const ra = rows[0].retry_after
    // Allow either NULL (the impl chose to skip setting it) or a valid Date.
    if (ra !== null) {
      const d = new Date(ra)
      assert.ok(!isNaN(d.getTime()), `${label}: retry_after must be a valid Date, got ${ra}`)
    }
  }

  it('retryAfter() with a NaN delay does not poison retry_after with "Invalid date"', async () => {
    const localQueue = new JobQueue(connection, logger)
    const queueId = 'jobqueue.test.js:13'
    await localQueue.enqueue(queueId, { foo: 'bar' })
    const { jobId } = await localQueue.dequeue(queueId, JOB_RUNNER_ID)
    await assert.doesNotReject(
      localQueue.retryAfter(jobId, JOB_RUNNER_ID, NaN, 'nan delay'),
      'retryAfter must not reject on NaN delay'
    )
    await assertRetryAfterIsValid(jobId, 'NaN delay')
  })

  it('retryAfter() with an Infinity delay does not poison retry_after with "Invalid date"', async () => {
    const localQueue = new JobQueue(connection, logger)
    const queueId = 'jobqueue.test.js:14'
    await localQueue.enqueue(queueId, { foo: 'bar' })
    const { jobId } = await localQueue.dequeue(queueId, JOB_RUNNER_ID)
    await assert.doesNotReject(
      localQueue.retryAfter(jobId, JOB_RUNNER_ID, Infinity, 'infinity delay'),
      'retryAfter must not reject on Infinity delay'
    )
    await assertRetryAfterIsValid(jobId, 'Infinity delay')
  })

  it('retryAfter() with an astronomically large delay does not poison retry_after', async () => {
    const localQueue = new JobQueue(connection, logger)
    const queueId = 'jobqueue.test.js:15'
    await localQueue.enqueue(queueId, { foo: 'bar' })
    const { jobId } = await localQueue.dequeue(queueId, JOB_RUNNER_ID)
    // The waitTime value seen in the production crash: ~6.8e19 ms.
    // Date.now() + this overflows JS Date, producing "Invalid Date".
    await assert.doesNotReject(
      localQueue.retryAfter(jobId, JOB_RUNNER_ID, 6.8e19, 'astronomical delay'),
      'retryAfter must not reject on astronomical delay'
    )
    await assertRetryAfterIsValid(jobId, 'astronomical delay')
  })
})
