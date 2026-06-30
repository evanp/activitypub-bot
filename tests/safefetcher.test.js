import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import dns from 'node:dns'
import dnsPromises from 'node:dns/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import Logger from 'pino'

import { SafeFetcher } from '../lib/safefetcher.js'
import { DomainBlocker } from '../lib/domainblocker.js'
import { createMigratedTestConnection } from './utils/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASIC_BLOCKLIST = resolve(__dirname, 'fixtures', 'blocklist-basic.csv')
const BLOCKED_HOST = 'blocked-one.test'

function mockDns (address) {
  dns.lookup = (hostname, callback) => callback(null, address)
  dnsPromises.lookup = async () => ({ address, family: address.includes(':') ? 6 : 4 })
}

function mockDnsError (err) {
  dns.lookup = (hostname, callback) => callback(err)
  dnsPromises.lookup = async () => { throw err }
}

describe('SafeFetcher', () => {
  let originalLookup
  let originalPromiseLookup
  let connection = null
  let domainBlocker = null

  before(async () => {
    originalLookup = dns.lookup
    originalPromiseLookup = dnsPromises.lookup
    const logger = Logger({ level: 'silent' })
    connection = await createMigratedTestConnection()
    domainBlocker = new DomainBlocker(BASIC_BLOCKLIST, connection, logger)
    await domainBlocker.initialize()
  })

  after(async () => {
    dns.lookup = originalLookup
    dnsPromises.lookup = originalPromiseLookup
    await connection.close()
  })

  it('can be constructed with just a domain blocker', () => {
    const fetcher = new SafeFetcher(domainBlocker)
    assert.ok(fetcher)
  })

  const isPrivateNetworkError = err =>
    err.name === 'PrivateNetworkError' ||
    err.cause?.name === 'PrivateNetworkError' ||
    (err.message && err.message.includes('Private network address'))

  it('rejects a fetch when the hostname resolves to a private IP', async () => {
    mockDns('192.168.1.1')
    const fetcher = new SafeFetcher(domainBlocker)
    await assert.rejects(fetcher.fetch('https://evil.example'), isPrivateNetworkError)
  })

  it('rejects a fetch when the hostname resolves to a loopback address', async () => {
    mockDns('127.0.0.1')
    const fetcher = new SafeFetcher(domainBlocker)
    await assert.rejects(fetcher.fetch('https://evil.example'), isPrivateNetworkError)
  })

  it('rejects a fetch when the hostname resolves to a link-local address', async () => {
    mockDns('169.254.1.1')
    const fetcher = new SafeFetcher(domainBlocker)
    await assert.rejects(fetcher.fetch('https://evil.example'), isPrivateNetworkError)
  })

  it('rejects a fetch when DNS lookup fails', async () => {
    mockDnsError(new Error('ENOTFOUND'))
    const fetcher = new SafeFetcher(domainBlocker)
    await assert.rejects(fetcher.fetch('https://nonexistent.example'))
  })

  it('rejects an http: URL that resolves to a public IP', async () => {
    mockDns('93.184.216.34')
    const fetcher = new SafeFetcher(domainBlocker)
    await assert.rejects(
      fetcher.fetch('http://example.com'),
      err => err.name === 'ProtocolError'
    )
  })

  it('rejects an unsupported protocol', async () => {
    const fetcher = new SafeFetcher(domainBlocker)
    await assert.rejects(
      fetcher.fetch('ftp://example.com'),
      err => err.name === 'ProtocolError'
    )
  })

  describe('with allowPrivate: true', () => {
    it('does not reject a private IP on the safety check', async () => {
      mockDns('192.168.1.1')
      const fetcher = new SafeFetcher(domainBlocker, { allowPrivate: true })
      await assert.rejects(
        fetcher.fetch('https://evil.example'),
        err => err.name !== 'PrivateNetworkError' &&
               !(err.cause && err.cause.name === 'PrivateNetworkError')
      )
    })

    it('accepts an http: URL that resolves to a private IP', async () => {
      mockDns('192.168.1.1')
      const fetcher = new SafeFetcher(domainBlocker, { allowPrivate: true })
      await assert.rejects(
        fetcher.fetch('http://misskey.test'),
        err => err.name !== 'ProtocolError'
      )
    })

    it('still rejects an http: URL that resolves to a public IP', async () => {
      mockDns('93.184.216.34')
      const fetcher = new SafeFetcher(domainBlocker, { allowPrivate: true })
      await assert.rejects(
        fetcher.fetch('http://example.com'),
        err => err.name === 'ProtocolError'
      )
    })
  })

  describe('allowPrivateNetworkRequests', () => {
    it('is false when constructed without options', () => {
      const fetcher = new SafeFetcher(domainBlocker)
      assert.strictEqual(fetcher.allowPrivateNetworkRequests, false)
    })

    it('is false when constructed with allowPrivate: false', () => {
      const fetcher = new SafeFetcher(domainBlocker, { allowPrivate: false })
      assert.strictEqual(fetcher.allowPrivateNetworkRequests, false)
    })

    it('is true when constructed with allowPrivate: true', () => {
      const fetcher = new SafeFetcher(domainBlocker, { allowPrivate: true })
      assert.strictEqual(fetcher.allowPrivateNetworkRequests, true)
    })
  })

  describe('domain blocking', () => {
    const isBlockedDomainError = err => err.name === 'BlockedDomainError'

    it('rejects a fetch to a blocked domain with a BlockedDomainError', async () => {
      mockDns('192.168.1.1')
      const fetcher = new SafeFetcher(domainBlocker)
      await assert.rejects(
        fetcher.fetch(`https://${BLOCKED_HOST}/user/blocky/inbox`),
        isBlockedDomainError
      )
    })

    it('rejects a blocked domain before the private-network check', async () => {
      mockDns('192.168.1.1')
      const fetcher = new SafeFetcher(domainBlocker)
      await assert.rejects(
        fetcher.fetch(`https://${BLOCKED_HOST}/user/blocky/note/1`),
        err => err.name === 'BlockedDomainError' && err.name !== 'PrivateNetworkError'
      )
    })

    it('rejects a blocked domain even when allowPrivate is true', async () => {
      mockDns('192.168.1.1')
      const fetcher = new SafeFetcher(domainBlocker, { allowPrivate: true })
      await assert.rejects(
        fetcher.fetch(`https://${BLOCKED_HOST}/user/blocky/inbox`),
        isBlockedDomainError
      )
    })

    it('allows a fetch to a non-blocked domain through to the safety checks', async () => {
      mockDns('192.168.1.1')
      const fetcher = new SafeFetcher(domainBlocker)
      await assert.rejects(
        fetcher.fetch('https://allowed.example/user/x'),
        isPrivateNetworkError
      )
    })
  })
})
