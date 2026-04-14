import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import dns from 'node:dns'
import https from 'node:https'
import { SafeAgent } from '../lib/safeagent.js'

describe('SafeAgent', () => {
  let originalLookup

  before(() => {
    originalLookup = dns.lookup
  })

  after(() => {
    dns.lookup = originalLookup
  })

  it('is an instance of https.Agent', () => {
    const agent = new SafeAgent()
    assert.ok(agent instanceof https.Agent)
  })

  it('calls back with an error for a private IP address', (t, done) => {
    dns.lookup = (hostname, callback) => {
      callback(null, '192.168.1.1')
    }
    const agent = new SafeAgent()
    agent.createConnection({ hostname: 'evil.example' }, (err) => {
      assert.ok(err)
      assert.strictEqual(err.name, 'PrivateNetworkError')
      assert.strictEqual(err.address, '192.168.1.1')
      done()
    })
  })

  it('calls back with an error for a loopback address', (t, done) => {
    dns.lookup = (hostname, callback) => {
      callback(null, '127.0.0.1')
    }
    const agent = new SafeAgent()
    agent.createConnection({ hostname: 'evil.example' }, (err) => {
      assert.ok(err)
      assert.strictEqual(err.name, 'PrivateNetworkError')
      done()
    })
  })

  it('calls back with an error for a link-local address', (t, done) => {
    dns.lookup = (hostname, callback) => {
      callback(null, '169.254.1.1')
    }
    const agent = new SafeAgent()
    agent.createConnection({ hostname: 'evil.example' }, (err) => {
      assert.ok(err)
      assert.strictEqual(err.name, 'PrivateNetworkError')
      done()
    })
  })

  it('forwards DNS lookup errors', (t, done) => {
    dns.lookup = (hostname, callback) => {
      callback(new Error('ENOTFOUND'))
    }
    const agent = new SafeAgent()
    agent.createConnection({ hostname: 'nonexistent.example' }, (err) => {
      assert.ok(err)
      assert.strictEqual(err.message, 'ENOTFOUND')
      done()
    })
  })

  it('calls super.createConnection for a public IP address', (t, done) => {
    dns.lookup = (hostname, callback) => {
      callback(null, '93.184.216.34')
    }
    const agent = new SafeAgent()
    const original = https.Agent.prototype.createConnection
    https.Agent.prototype.createConnection = function (options) {
      assert.strictEqual(options.host, '93.184.216.34')
      assert.strictEqual(options.hostname, 'example.com')
      assert.strictEqual(options.servername, 'example.com')
      return 'fake-socket'
    }
    agent.createConnection({ hostname: 'example.com' }, (err, socket) => {
      https.Agent.prototype.createConnection = original
      assert.ifError(err)
      assert.strictEqual(socket, 'fake-socket')
      done()
    })
  })
})
