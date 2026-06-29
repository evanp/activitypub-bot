import assert from 'node:assert'
import fs from 'node:fs'
import { parse } from 'csv-parse'

export class DomainBlocker {
  #filename
  #connection
  #logger

  constructor (filename, connection, logger) {
    assert.ok(typeof filename, 'string')
    assert.ok(typeof connection, 'object')
    assert.ok(typeof logger, 'object')
    this.#filename = filename
    this.#connection = connection
    this.#logger = logger
  }

  async initialize () {
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
  }

  async isBlocked (url) {
    const parsed = URL.parse(url)
    const hostname = parsed.hostname

    const parts = hostname.split('.')
    const suffixes = []
    let suffix = null
    for (let i = parts.length - 1; i >= 0; i--) {
      suffix = (suffix) ? parts[i] + '.' + suffix : parts[i]
      suffixes.push(suffix)
    }

    const [result] = await this.#connection.query(
      `SELECT COUNT(*) as domain_count FROM domain_block
       WHERE domain_name in (?)
      `,
      { replacements: [suffixes] }
    )

    return result[0].domain_count > 0
  }
}
