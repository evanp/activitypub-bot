import assert from 'node:assert'
import fs from 'node:fs'
import { parse } from 'csv-parse'
import as2 from './activitystreams.js'

const AS2 = 'https://www.w3.org/ns/activitystreams'
const SKIP_KEYS = [
  `${AS2}#to`,
  `${AS2}#cc`,
  `${AS2}#bto`,
  `${AS2}#bcc`,
  `${AS2}#audience`,
  `${AS2}#formerType`,
  '@type',
  '@id'
]

export class DomainBlocker {
  #filename
  #connection
  #logger
  #domainNames
  constructor (filename, connection, logger) {
    assert.ok(typeof filename === 'string' || !filename)
    assert.strictEqual(typeof connection, 'object')
    assert.strictEqual(typeof logger, 'object')
    this.#filename = filename
    this.#connection = connection
    this.#logger = logger.child({ class: this.constructor.name })
  }

  async initialize () {
    if (!this.#filename) {
      this.#logger.warn(
        'no domain block filename so skipping sync'
      )
      return
    }

    this.#logger.info(
      { filename: this.#filename },
      'reading domain block file'
    )

    const parser = fs.createReadStream(this.#filename).pipe(parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    }))

    const domains = new Set()

    for await (const record of parser) {
      if (record['#severity'] !== 'suspend') {
        this.#logger.warn(
          { domain: record['#domain'], severity: record['#severity'] }, 'skipping domain with non-suspend severity'
        )
        continue
      }
      if (record['#domain'].includes('*')) {
        this.#logger.warn(
          { domain: record['#domain'] }, 'skipping domain with wildcard marker'
        )
        continue
      }

      const domain = record['#domain'].toLowerCase()

      domains.add(domain)

      this.#logger.info({ domain }, 'Ensuring domain block')

      await this.#connection.query(
        `INSERT INTO domain_block (domain_name)
         VALUES (?)
         ON CONFLICT (domain_name) DO NOTHING;`,
        { replacements: [domain] }
      )
    }

    this.#logger.info('Removing unused domain blocks')

    await this.#connection.query(
      `DELETE FROM domain_block
       WHERE domain_name NOT IN (?)
      `,
      { replacements: [Array.from(domains)] }
    )

    this.#logger.info('Priming cache')

    await this.#getDomainNames()
  }

  async isBlocked (url) {
    const parsed = URL.parse(url)

    if (!parsed?.hostname) {
      return false
    }

    const hostname = parsed.hostname

    const parts = hostname.split('.')
    const suffixes = []
    let suffix = null
    for (let i = parts.length - 1; i >= 0; i--) {
      suffix = (suffix) ? parts[i] + '.' + suffix : parts[i]
      suffixes.push(suffix)
    }

    const domainNames = await this.#getDomainNames()

    return suffixes.some((suffix) => domainNames.has(suffix))
  }

  async isBlockedObject (obj) {
    if (obj.id && await this.isBlocked(obj.id)) {
      return true
    }
    for (const key of obj) {
      if (SKIP_KEYS.includes(key)) {
        continue
      }

      const val = obj.get(key)

      if (val == null) {
        continue
      }

      if (val instanceof as2.models.Base) {
        if (await this.isBlockedObject(val)) {
          return true
        }
        continue
      }

      if (typeof val[Symbol.iterator] !== 'function') {
        continue
      }

      for (const item of val) {
        if (item instanceof as2.models.Base) {
          if (await this.isBlockedObject(item)) {
            return true
          }
        }
      }
    }
    return false
  }

  async #getDomainNames () {
    if (!this.#domainNames) {
      const [result] = await this.#connection.query(
        'SELECT domain_name FROM domain_block'
      )
      this.#domainNames = new Set(result.map((row) => row.domain_name))
    }
    return this.#domainNames
  }
}
