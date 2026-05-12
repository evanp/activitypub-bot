import { setTimeout as sleep } from 'node:timers/promises'
import assert from 'node:assert'

import { nanoid } from 'nanoid'
import { QueryTypes } from 'sequelize'

const MAX_DELAY = 30000
const DEFAULT_PRIORITY = 1000000
const MAX_RETRY = 30 * 24 * 60 * 60 * 1000

export class JobQueue {
  #connection
  #logger
  #ac
  #wakeAc

  constructor (connection, logger) {
    this.#connection = connection
    this.#logger = logger.child({ class: this.constructor.name })
    this.#ac = new AbortController()
    this.#wakeAc = new AbortController()
  }

  async enqueue (queueId, payload = {}, options = { priority: DEFAULT_PRIORITY }) {
    const { priority } = options
    const jobId = nanoid()
    const encoded = JSON.stringify(payload)
    await this.#connection.query(
      `INSERT INTO job (job_id, queue_id, payload, priority)
      VALUES (?, ?, ?, ?);`,
      { replacements: [jobId, queueId, encoded, priority] }
    )
    this.#logger.debug({ method: 'enqueue', queueId, jobId }, 'enqueued job')
    const old = this.#wakeAc
    this.#wakeAc = new AbortController()
    old.abort()
    return jobId
  }

  async dequeue (queueId, jobRunnerId) {
    let res
    let delay = 50

    this.#logger.debug(
      { method: 'dequeue', queueId, jobRunnerId },
      'dequeueing job'
    )

    let armed = this.#armCombined()
    try {
      while (!res) {
        res = await this.#claimNextJob(queueId, jobRunnerId)
        if (res) break
        delay = Math.min(delay * 2, MAX_DELAY)
        this.#logger.debug({ method: 'dequeue', delay }, 'sleeping')
        try {
          await sleep(delay, null, { signal: armed.signal })
        } catch (err) {
          if (this.#ac.signal.aborted) throw err
          delay = 50
          // Wake fired — tear down old listeners and arm a fresh combined signal.
          this.#disarmCombined(armed)
          armed = this.#armCombined()
        }
      }
    } finally {
      this.#disarmCombined(armed)
    }

    const jobId = res.job_id
    const payload = JSON.parse(res.payload)
    const attempts = res.attempts

    this.#logger.debug({ method: 'dequeue', queueId, jobId }, 'dequeued job')
    return { jobId, payload, attempts }
  }

  // Build a combined abort signal manually, avoiding AbortSignal.any() which
  // registers a FinalizationRegistry callback per call (Node's
  // sourceSignalsCleanupRegistry). Under the dequeue loop's call rate, those
  // registrations dominate heap growth.
  #armCombined () {
    const combinedAc = new AbortController()
    const onAbort = () => combinedAc.abort()
    const wakeAc = this.#wakeAc
    this.#ac.signal.addEventListener('abort', onAbort, { once: true })
    wakeAc.signal.addEventListener('abort', onAbort, { once: true })
    return { signal: combinedAc.signal, onAbort, wakeAc }
  }

  #disarmCombined (armed) {
    this.#ac.signal.removeEventListener('abort', armed.onAbort)
    armed.wakeAc.signal.removeEventListener('abort', armed.onAbort)
  }

  async complete (jobId, jobRunnerId) {
    await this.#connection.query(`
      DELETE FROM job
      WHERE job_id = ? AND claimed_by = ?;`,
    { replacements: [jobId, jobRunnerId] }
    )
    this.#logger.debug({ method: 'complete', jobRunnerId, jobId }, 'completed job')
  }

  async release (jobId, jobRunnerId) {
    await this.#connection.query(`
      UPDATE job
      SET claimed_by = NULL,
          claimed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ? AND claimed_by = ?;`,
    { replacements: [jobId, jobRunnerId] }
    )
    this.#logger.debug({ method: 'release', jobRunnerId, jobId }, 'released job')
  }

  async retryAfter (jobId, jobRunnerId, delay, lastError = null) {
    assert.ok(jobId)
    assert.strictEqual(typeof jobId, 'string')
    assert.ok(jobRunnerId)
    assert.strictEqual(typeof jobRunnerId, 'string')
    assert.strictEqual(typeof delay, 'number')

    const retryAfter = (isNaN(delay))
      ? new Date(Date.now() + 1000)
      : (!isFinite(delay))
          ? new Date(Date.now() + MAX_RETRY)
          : new Date(Date.now() + Math.max(0, Math.min(delay, MAX_RETRY)))

    await this.#connection.query(`
      UPDATE job
      SET claimed_by = NULL,
          claimed_at = NULL,
          updated_at = CURRENT_TIMESTAMP,
          retry_after = ?,
          last_error = ?
      WHERE job_id = ? AND claimed_by = ?;`,
    { replacements: [retryAfter, lastError, jobId, jobRunnerId] }
    )
    this.#logger.debug(
      { method: 'retry', jobRunnerId, jobId, delay },
      'released job'
    )
  }

  async onIdle (queueId) {
    assert.ok(queueId)
    assert.strictEqual(typeof queueId, 'string')

    let delay = 50

    this.#logger.debug({ method: 'onIdle', queueId }, 'getting queue size')

    let jobCount = await this.#countJobs(queueId)

    this.#logger.debug({ method: 'onIdle', queueId, jobCount }, 'got queue size')

    while (jobCount > 0) {
      delay = Math.min(delay * 2, MAX_DELAY)
      this.#logger.debug({ method: 'onIdle', delay }, 'sleeping')
      await sleep(delay, null, { signal: this.#ac.signal })
      jobCount = await this.#countJobs(queueId)
      this.#logger.debug({ method: 'onIdle', queueId, jobCount }, 'got queue size')
    }
    this.#logger.debug({ method: 'onIdle', queueId }, 'Now idle')
  }

  async sweep (timeout) {
    const cutoff = new Date(Date.now() - timeout)
    const [, meta] = await this.#connection.query(`
      UPDATE job
      SET claimed_by = NULL,
          claimed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE claimed_at < ?;`,
    { replacements: [cutoff] }
    )
    const count = meta?.changes ?? meta?.rowCount ?? 0
    if (count > 0) {
      this.#logger.warn({ method: 'sweep', count }, 'released stalled jobs')
    } else {
      this.#logger.debug({ method: 'sweep' }, 'no stalled jobs found')
    }
  }

  abort () {
    this.#logger.debug('Aborting queue server')
    this.#ac.abort()
  }

  async fail (jobId, jobRunnerId, lastError = null) {
    await this.#connection.query(`
      INSERT INTO failed_job
      (job_id, queue_id, priority, payload, claimed_at, claimed_by, attempts, retry_after, created_at, updated_at)
      SELECT job_id, queue_id, priority, payload, claimed_at, claimed_by, attempts, retry_after, created_at, updated_at
      FROM job
      WHERE job_id = ?
      AND claimed_by = ?;`,
    { replacements: [jobId, jobRunnerId] })
    await this.#connection.query(`
      DELETE FROM job
      WHERE job_id = ? AND claimed_by = ?;`,
    { replacements: [jobId, jobRunnerId] })

    if (lastError) {
      await this.#connection.query(`
      UPDATE failed_job
      SET last_error = ?
      WHERE job_id = ?;`,
      { replacements: [lastError, jobId] })
    }
    this.#logger.debug({ method: 'complete', jobRunnerId, jobId }, 'completed job')
  }

  async #countJobs (queueId) {
    this.#logger.debug({ method: '#countJobs', queueId }, 'checking queue size')
    const rows = await this.#connection.query(`
      SELECT COUNT(*) as job_count
      FROM JOB
      WHERE queue_id = ?;
    `, { replacements: [queueId] })
    if (rows[0]) {
      const size = rows[0][0].job_count
      this.#logger.debug({ method: '#countJobs', queueId, size }, 'got queue size')
      return size
    } else {
      this.#logger.debug({ method: '#countJobs', queueId }, 'no queue size')
      return 0
    }
  }

  async #claimNextJob (queueId, jobRunnerId) {
    this.#logger.debug(
      { method: '#claimNextJob', queueId, jobRunnerId },
      'claiming next job'
    )
    const skipLocked = this.#connection.getDialect() === 'postgres' ? 'FOR UPDATE SKIP LOCKED' : ''
    const rows = await this.#connection.query(`
      UPDATE job
      SET claimed_by = ?,
          claimed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          attempts = attempts + 1
      WHERE job_id = (
        SELECT job_id
        FROM job
        WHERE queue_id = ?
          AND (
            claimed_by IS NULL
          )
          AND (
            retry_after IS NULL OR
            retry_after < ?
          )
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
        ${skipLocked}
      )
      RETURNING job_id, payload, attempts;`,
    {
      replacements: [jobRunnerId, queueId, new Date()],
      type: QueryTypes.SELECT
    }
    )
    if (rows[0]) {
      this.#logger.debug(
        { method: '#claimNextJob', queueId, jobRunnerId, jobId: rows[0].job_id },
        'got a job'
      )
      return rows[0]
    } else {
      this.#logger.debug(
        { method: '#claimNextJob', queueId, jobRunnerId },
        'no job found'
      )
      return null
    }
  }
}
