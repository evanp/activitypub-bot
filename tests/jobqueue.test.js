import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import { createMigratedTestConnection } from './utils/db.js'

const JOB_RUNNER_ID = 'jobqueue.test.js'

describe('JobQueue', async () => {
  let connection = null
  let logger = null
  let JobQueue = null
  let queue = null
  let jobId = null
  let payload = null

  before(async () => {
    connection = await createMigratedTestConnection()
    logger = new Logger({
      level: 'silent'
    })
  })

  after(async () => {
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
    jobId = await queue.enqueue('test1', { addends: [2, 2] })
    assert.ok(jobId)
  })

  it('can dequeue', async () => {
    const result = await queue.dequeue('test1', JOB_RUNNER_ID);
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
    await queue.enqueue('test2', { factors: [2, 2] })
    const job2 = await queue.dequeue('test2', JOB_RUNNER_ID)
    await queue.release(job2.jobId, JOB_RUNNER_ID)
    const job3 = await queue.dequeue('test2', JOB_RUNNER_ID)
    assert.equal(job3.jobId, job2.jobId)
  })

  it('can dequeue before enqueue', async () => {
    let enqueued
    setTimeout(() => {
      queue.enqueue('test3', { name: 'foo' }).then((v) => { enqueued = v })
    }, 100)
    const job = await queue.dequeue('test3', JOB_RUNNER_ID)
    assert.equal(job.jobId, enqueued)
  })

  it('can tell when the queue is idle', async () => {
    await queue.enqueue('test4', { foo: 'bar' })
    await queue.enqueue('test4', { foo: 'baz' })
    await queue.enqueue('test4', { foo: 'quux' })
    setTimeout(() => {
      queue.dequeue('test4', JOB_RUNNER_ID)
        .then((job) => queue.complete(job.jobId, JOB_RUNNER_ID))
        .then()
      queue.dequeue('test4', JOB_RUNNER_ID)
        .then((job) => queue.complete(job.jobId, JOB_RUNNER_ID))
        .then()
      queue.dequeue('test4', JOB_RUNNER_ID)
        .then((job) => queue.complete(job.jobId, JOB_RUNNER_ID))
        .then()
    }, 100)
    await queue.onIdle('test4')
    assert.ok(true)
  })

  it('can tell when an untouched queue is idle', async () => {
    await queue.onIdle('test5')
    assert.ok(true)
  })
})
