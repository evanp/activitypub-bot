import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const JOB_RUNNER_ID = 'jobqueue.test.js'

describe('JobQueue', async () => {
  const testQueues = [...Array(7).keys()].map(i => `jobqueue.test.js:${i}`)
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
})
