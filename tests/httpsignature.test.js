import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'
import { Sequelize } from 'sequelize'
import { KeyStorage } from '../lib/keystorage.js'
import { nockSetup, nockSignature, nockKeyRotate, getPublicKey, getPrivateKey, nockFormat } from './utils/nock.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import Logger from 'pino'
import { Digester } from '../lib/digester.js'

describe('HTTPSignature', async () => {
  const domain = 'activitypubbot.example'
  const origin = `https://${domain}`
  let connection = null
  let httpSignature = null
  let logger = null
  let digester = null
  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    connection = new Sequelize('sqlite::memory:', { logging: false })
    await connection.authenticate()
    const keyStorage = new KeyStorage(connection, logger)
    await keyStorage.initialize()
    nockSetup('social.example')
    digester = new Digester(logger)
  })

  after(async () => {
    await connection.close()
    digester = null
  })

  it('can initialize', async () => {
    httpSignature = new HTTPSignature(logger)
    assert.ok(httpSignature)
  })

  it('can validate a signature', async () => {
    const username = 'test'
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username)
    const method = 'GET'
    const path = '/user/ok/outbox'
    const result = await httpSignature.validate(publicKeyPem, signature, method, path, headers)
    assert.ok(result)
  })

  it('can validate a signature on an URL with parameters', async () => {
    const username = 'test'
    const lname = 'ok'
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/.well-known/webfinger?resource=acct:${lname}@${domain}`,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username)
    const method = 'GET'
    const path = `/.well-known/webfinger?resource=acct:${lname}@${domain}`
    const result = await httpSignature.validate(publicKeyPem, signature, method, path, headers)
    assert.ok(result)
  })

  it('can handle key rotation', async () => {
    const username = 'rotate'
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username)
    const method = 'GET'
    const path = '/user/ok/outbox'
    await httpSignature.validate(publicKeyPem, signature, method, path, headers)
    await nockKeyRotate(username)
    const signature2 = await nockSignature({
      url: `${origin}/user/ok/outbox`,
      date,
      username
    })
    const headers2 = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem2 = await getPublicKey(username)
    assert.notStrictEqual(publicKeyPem, publicKeyPem2)
    const result2 = await httpSignature.validate(publicKeyPem2, signature2, method, path, headers2)
    assert.ok(result2)
  })

  it('can sign a GET request', async () => {
    const date = new Date().toUTCString()
    const headers = {
      Date: date,
      Host: URL.parse(origin).host,
      'X-Unused-Header': 'test',
      Accept: 'application/activity+json',
      'User-Agent': 'activitypubbot-test/0.0.1'
    }
    const privateKey = await getPrivateKey('test')
    const method = 'GET'
    const url = nockFormat({ username: 'test', obj: 'outbox' })
    const keyId = nockFormat({ username: 'test', key: true })
    const signature = await httpSignature.sign({ privateKey, keyId, url, method, headers })
    assert.ok(signature)
    assert.match(signature, /^keyId="https:\/\/social\.example\/user\/test\/publickey",headers="\(request-target\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$/)
  })

  it('can sign a POST request', async () => {
    const body = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      actor: nockFormat({ username: 'test' }),
      object: nockFormat({ username: 'test', obj: 'note', num: 1 })
    })
    const headers = {
      date: new Date().toUTCString(),
      host: URL.parse(origin).host,
      digest: await digester.digest(body),
      'content-type': 'application/activity+json',
      'User-Agent': 'activitypubbot-test/0.0.1'
    }
    const privateKey = await getPrivateKey('test')
    const method = 'POST'
    const url = nockFormat({ username: 'test', obj: 'outbox' })
    const keyId = nockFormat({ username: 'test', key: true })
    const signature = await httpSignature.sign({ privateKey, keyId, url, method, headers })
    assert.ok(signature)
    assert.match(signature, /^keyId="https:\/\/social\.example\/user\/test\/publickey",headers="\(request-target\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$/)
  })

  it('errors if required GET headers not present', async () => {
    const date = new Date().toUTCString()
    const headers = {
      Date: date,
      Host: URL.parse(origin).host,
      'User-Agent': 'activitypubbot-test/0.0.1'
    }
    const privateKey = await getPrivateKey('test')
    const method = 'GET'
    const url = nockFormat({ username: 'test', obj: 'outbox' })
    const keyId = nockFormat({ username: 'test', key: true })
    try {
      await httpSignature.sign({ privateKey, keyId, url, method, headers })
      assert.fail('Expected error not thrown')
    } catch (err) {
      assert.equal(err.name, 'Error')
      assert.equal(err.message, 'Missing header: accept')
    }
  })

  it('errors if required POST headers not present', async () => {
    const body = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      actor: nockFormat({ username: 'test' }),
      object: nockFormat({ username: 'test', obj: 'note', num: 1 })
    })
    const headers = {
      date: new Date().toUTCString(),
      host: URL.parse(origin).host,
      digest: await digester.digest(body),
      'User-Agent': 'activitypubbot-test/0.0.1'
    }
    const privateKey = await getPrivateKey('test')
    const method = 'POST'
    const url = nockFormat({ username: 'test', obj: 'outbox' })
    const keyId = nockFormat({ username: 'test', key: true })
    try {
      await httpSignature.sign({ privateKey, keyId, url, method, headers })
      assert.fail('Expected error not thrown')
    } catch (err) {
      assert.equal(err.name, 'Error')
      assert.equal(err.message, 'Missing header: content-type')
    }
  })
})
