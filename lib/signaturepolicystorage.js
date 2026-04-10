import assert from 'node:assert'

export class SignaturePolicyStorage {
  static RFC9421 = 'rfc9421'
  static DRAFT_CAVAGE_12 = 'draft-cavage-12'
  static #policies = [
    SignaturePolicyStorage.RFC9421,
    SignaturePolicyStorage.DRAFT_CAVAGE_12
  ]

  static #EXPIRY_OFFSET = 30 * 24 * 60 * 60 * 1000

  #connection
  #logger
  constructor (connection, logger) {
    assert.ok(connection)
    assert.strictEqual(typeof connection, 'object')
    assert.ok(logger)
    assert.strictEqual(typeof logger, 'object')
    this.#connection = connection
    this.#logger = logger
  }

  async get (domain) {
    assert.ok(domain)
    assert.strictEqual(typeof domain, 'string')
    const [rows] = await this.#connection.query(
      'SELECT policy, expiry FROM signature_policy WHERE domain = ?',
      { replacements: [domain] }
    )
    if (rows.length === 0) {
      return null
    }
    const { policy, expiry } = rows[0]
    return ((new Date(expiry)) > (new Date()))
      ? policy
      : null
  }

  async set (domain, policy) {
    assert.ok(domain)
    assert.strictEqual(typeof domain, 'string')
    assert.ok(policy)
    assert.strictEqual(typeof policy, 'string')
    assert.ok(SignaturePolicyStorage.#policies.includes(policy))

    const expiry = new Date(
      Date.now() + SignaturePolicyStorage.#EXPIRY_OFFSET
    )

    await this.#connection.query(
      `INSERT INTO signature_policy (domain, policy, expiry)
       VALUES (?, ?, ?)
       ON CONFLICT (domain) DO UPDATE
       SET policy = EXCLUDED.policy,
           expiry = EXCLUDED.expiry,
           updated_at = CURRENT_TIMESTAMP`,
      { replacements: [domain, policy, expiry] }
    )
  }
}
