import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'

import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

describe('SignaturePolicyStorage', async () => {
  const RFC9421_ORIGIN = 'https://social-rfc9421.signaturepolicystorage.test'
  const DRAFT_CAVAGE_ORIGIN = 'https://social-draft.signaturepolicystorage.test'
  const UPDATE_ORIGIN = 'https://social-update.signaturepolicystorage.test'
  const EXPIRED_ORIGIN = 'https://social-expired.signaturepolicystorage.test'
  const MISSING_ORIGIN = 'https://social-missing.signaturepolicystorage.test'

  let connection = null
  let logger = null
  let storage = null

  before(async () => {
    logger = new Logger({ level: 'silent' })
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      remoteDomains: [
        RFC9421_ORIGIN,
        DRAFT_CAVAGE_ORIGIN,
        UPDATE_ORIGIN,
        EXPIRED_ORIGIN,
        MISSING_ORIGIN
      ]
    })
    storage = new SignaturePolicyStorage(connection, logger)
  })

  after(async () => {
    await cleanupTestData(connection, {
      remoteDomains: [
        RFC9421_ORIGIN,
        DRAFT_CAVAGE_ORIGIN,
        UPDATE_ORIGIN,
        EXPIRED_ORIGIN,
        MISSING_ORIGIN
      ]
    })
    await connection.close()
    connection = null
    logger = null
    storage = null
  })

  it('can initialize', async () => {
    assert.ok(storage)
  })

  it('defines the signature policy constants', async () => {
    assert.strictEqual(SignaturePolicyStorage.RFC9421, 'rfc9421')
    assert.strictEqual(SignaturePolicyStorage.DRAFT_CAVAGE_12, 'draft-cavage-12')
  })

  it('get() on a missing origin returns null', async () => {
    const result = await storage.get(MISSING_ORIGIN)
    assert.strictEqual(result, null)
  })

  it('set() then get() stores the rfc9421 policy', async () => {
    await storage.set(RFC9421_ORIGIN, SignaturePolicyStorage.RFC9421)

    const result = await storage.get(RFC9421_ORIGIN)
    assert.strictEqual(result, SignaturePolicyStorage.RFC9421)
  })

  it('set() then get() stores the draft-cavage-12 policy', async () => {
    await storage.set(DRAFT_CAVAGE_ORIGIN, SignaturePolicyStorage.DRAFT_CAVAGE_12)

    const result = await storage.get(DRAFT_CAVAGE_ORIGIN)
    assert.strictEqual(result, SignaturePolicyStorage.DRAFT_CAVAGE_12)
  })

  it('a later set() overwrites an earlier policy for the same origin', async () => {
    await storage.set(UPDATE_ORIGIN, SignaturePolicyStorage.RFC9421)
    await storage.set(UPDATE_ORIGIN, SignaturePolicyStorage.DRAFT_CAVAGE_12)

    const result = await storage.get(UPDATE_ORIGIN)
    assert.strictEqual(result, SignaturePolicyStorage.DRAFT_CAVAGE_12)
  })

  it('get() returns null for an expired policy', async () => {
    await storage.set(EXPIRED_ORIGIN, SignaturePolicyStorage.RFC9421)
    await connection.query(
      'UPDATE signature_policy SET expiry = ? WHERE origin = ?',
      { replacements: [new Date(Date.now() - 1000), EXPIRED_ORIGIN] }
    )

    const result = await storage.get(EXPIRED_ORIGIN)
    assert.strictEqual(result, null)
  })
})
