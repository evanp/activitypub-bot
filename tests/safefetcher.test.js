import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import dns from 'node:dns'
import dnsPromises from 'node:dns/promises'

import { SafeAgent } from '../lib/safeagent.js'
import { SafeFetcher } from '../lib/safefetcher.js'

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

  before(() => {
    originalLookup = dns.lookup
    originalPromiseLookup = dnsPromises.lookup
  })

  after(() => {
    dns.lookup = originalLookup
    dnsPromises.lookup = originalPromiseLookup
  })

  it('can be constructed with a SafeAgent', () => {
    const fetcher = new SafeFetcher(new SafeAgent())
    assert.ok(fetcher)
  })

  const isPrivateNetworkError = err =>
    err.name === 'PrivateNetworkError' ||
    err.cause?.name === 'PrivateNetworkError' ||
    (err.message && err.message.includes('Private network address'))

  it('rejects a fetch when the hostname resolves to a private IP', async () => {
    mockDns('192.168.1.1')
    const fetcher = new SafeFetcher(new SafeAgent())
    await assert.rejects(fetcher.fetch('https://evil.example'), isPrivateNetworkError)
  })

  it('rejects a fetch when the hostname resolves to a loopback address', async () => {
    mockDns('127.0.0.1')
    const fetcher = new SafeFetcher(new SafeAgent())
    await assert.rejects(fetcher.fetch('https://evil.example'), isPrivateNetworkError)
  })

  it('rejects a fetch when the hostname resolves to a link-local address', async () => {
    mockDns('169.254.1.1')
    const fetcher = new SafeFetcher(new SafeAgent())
    await assert.rejects(fetcher.fetch('https://evil.example'), isPrivateNetworkError)
  })

  it('rejects a fetch when DNS lookup fails', async () => {
    mockDnsError(new Error('ENOTFOUND'))
    const fetcher = new SafeFetcher(new SafeAgent())
    await assert.rejects(fetcher.fetch('https://nonexistent.example'))
  })

  it('rejects an http: URL that resolves to a public IP', async () => {
    mockDns('93.184.216.34')
    const fetcher = new SafeFetcher(new SafeAgent())
    await assert.rejects(
      fetcher.fetch('http://example.com'),
      err => err.name === 'ProtocolError'
    )
  })

  it('rejects an unsupported protocol', async () => {
    const fetcher = new SafeFetcher(new SafeAgent())
    await assert.rejects(
      fetcher.fetch('ftp://example.com'),
      err => err.name === 'ProtocolError'
    )
  })

  describe('with allowPrivate: true', () => {
    it('does not reject a private IP on the safety check', async () => {
      mockDns('192.168.1.1')
      const fetcher = new SafeFetcher(new SafeAgent(), { allowPrivate: true })
      // Should NOT reject with PrivateNetworkError. The fetch itself may still
      // fail (network unreachable, ECONNREFUSED, etc.) — we just assert it
      // doesn't reject for the private-network reason.
      await assert.rejects(
        fetcher.fetch('https://evil.example'),
        err => err.name !== 'PrivateNetworkError' &&
               !(err.cause && err.cause.name === 'PrivateNetworkError')
      )
    })

    it('accepts an http: URL that resolves to a private IP', async () => {
      mockDns('192.168.1.1')
      const fetcher = new SafeFetcher(new SafeAgent(), { allowPrivate: true })
      await assert.rejects(
        fetcher.fetch('http://misskey.test'),
        err => err.name !== 'ProtocolError'
      )
    })

    it('still rejects an http: URL that resolves to a public IP', async () => {
      mockDns('93.184.216.34')
      const fetcher = new SafeFetcher(new SafeAgent(), { allowPrivate: true })
      await assert.rejects(
        fetcher.fetch('http://example.com'),
        err => err.name === 'ProtocolError'
      )
    })
  })

  describe('allowPrivateNetworkRequests', () => {
    it('is false when constructed without allowPrivate', () => {
      const fetcher = new SafeFetcher(new SafeAgent())
      assert.strictEqual(fetcher.allowPrivateNetworkRequests, false)
    })

    it('is false when constructed with allowPrivate: false', () => {
      const fetcher = new SafeFetcher(new SafeAgent(), { allowPrivate: false })
      assert.strictEqual(fetcher.allowPrivateNetworkRequests, false)
    })

    it('is true when constructed with allowPrivate: true', () => {
      const fetcher = new SafeFetcher(new SafeAgent(), { allowPrivate: true })
      assert.strictEqual(fetcher.allowPrivateNetworkRequests, true)
    })
  })
})
