import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'
import { nockSetup, nockSignature, nockKeyRotate, getPublicKey, getPrivateKey, nockFormat } from '@evanp/activitypub-nock'
import { HTTPSignature } from '../lib/httpsignature.js'
import Logger from 'pino'
import { Digester } from '../lib/digester.js'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

function escapeRegex (str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('HTTPSignature', async () => {
  const domain = 'local.httpsignature.test'
  const remoteDomain = 'social.httpsignature.test'
  const origin = `https://${domain}`
  const localUser = 'httpsignaturetestlocal'
  const signerUser = 'httpsignaturetestsigner'
  const rotateUser = 'httpsignaturetestrotate'
  const testUsernames = [localUser]
  const SIGNATURE_GET_RE = new RegExp(
    `^keyId="https://${escapeRegex(remoteDomain)}/user/${escapeRegex(signerUser)}/publickey",headers="\\(request-target\\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$`
  )
  const SIGNATURE_POST_RE = new RegExp(
    `^keyId="https://${escapeRegex(remoteDomain)}/user/${escapeRegex(signerUser)}/publickey",headers="\\(request-target\\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$`
  )
  let connection = null
  let httpSignature = null
  let logger = null
  let digester = null
  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: domain,
      remoteDomains: [remoteDomain]
    })
    nockSetup(remoteDomain)
    digester = new Digester(logger)
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: testUsernames,
      localDomain: domain,
      remoteDomains: [remoteDomain]
    })
    await connection.close()
    digester = null
  })

  it('can initialize', async () => {
    httpSignature = new HTTPSignature(logger)
    assert.ok(httpSignature)
  })

  it('can validate a signature', async () => {
    const username = signerUser
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/${localUser}/outbox`,
      date,
      username,
      domain: remoteDomain
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username, remoteDomain)
    const method = 'GET'
    const path = `/user/${localUser}/outbox`
    const result = await httpSignature.validate(publicKeyPem, signature, method, path, headers)
    assert.ok(result)
  })

  it('can validate a signature on an URL with parameters', async () => {
    const username = signerUser
    const lname = localUser
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/.well-known/webfinger?resource=acct:${lname}@${domain}`,
      date,
      username,
      domain: remoteDomain
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username, remoteDomain)
    const method = 'GET'
    const path = `/.well-known/webfinger?resource=acct:${lname}@${domain}`
    const result = await httpSignature.validate(publicKeyPem, signature, method, path, headers)
    assert.ok(result)
  })

  it('can handle key rotation', async () => {
    const username = rotateUser
    const date = new Date().toUTCString()
    const signature = await nockSignature({
      url: `${origin}/user/${localUser}/outbox`,
      date,
      username,
      domain: remoteDomain
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username, remoteDomain)
    const method = 'GET'
    const path = `/user/${localUser}/outbox`
    await httpSignature.validate(publicKeyPem, signature, method, path, headers)
    await nockKeyRotate(username, remoteDomain)
    const signature2 = await nockSignature({
      url: `${origin}/user/${localUser}/outbox`,
      date,
      username,
      domain: remoteDomain
    })
    const headers2 = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem2 = await getPublicKey(username, remoteDomain)
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
    const privateKey = await getPrivateKey(signerUser, remoteDomain)
    const method = 'GET'
    const url = nockFormat({ domain: remoteDomain, username: signerUser, obj: 'outbox' })
    const keyId = nockFormat({ domain: remoteDomain, username: signerUser, key: true })
    const signature = await httpSignature.sign({ privateKey, keyId, url, method, headers })
    assert.ok(signature)
    assert.match(signature, SIGNATURE_GET_RE)
  })

  it('can sign a POST request', async () => {
    const body = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      actor: nockFormat({ domain: remoteDomain, username: signerUser }),
      object: nockFormat({ domain: remoteDomain, username: signerUser, obj: 'note', num: 1 })
    })
    const headers = {
      date: new Date().toUTCString(),
      host: URL.parse(origin).host,
      digest: await digester.digest(body),
      'content-type': 'application/activity+json',
      'User-Agent': 'activitypubbot-test/0.0.1'
    }
    const privateKey = await getPrivateKey(signerUser, remoteDomain)
    const method = 'POST'
    const url = nockFormat({ domain: remoteDomain, username: signerUser, obj: 'outbox' })
    const keyId = nockFormat({ domain: remoteDomain, username: signerUser, key: true })
    const signature = await httpSignature.sign({ privateKey, keyId, url, method, headers })
    assert.ok(signature)
    assert.match(signature, SIGNATURE_POST_RE)
  })

  it('errors if required GET headers not present', async () => {
    const date = new Date().toUTCString()
    const headers = {
      Date: date,
      Host: URL.parse(origin).host,
      'User-Agent': 'activitypubbot-test/0.0.1'
    }
    const privateKey = await getPrivateKey(signerUser, remoteDomain)
    const method = 'GET'
    const url = nockFormat({ domain: remoteDomain, username: signerUser, obj: 'outbox' })
    const keyId = nockFormat({ domain: remoteDomain, username: signerUser, key: true })
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
      actor: nockFormat({ domain: remoteDomain, username: signerUser }),
      object: nockFormat({ domain: remoteDomain, username: signerUser, obj: 'note', num: 1 })
    })
    const headers = {
      date: new Date().toUTCString(),
      host: URL.parse(origin).host,
      digest: await digester.digest(body),
      'User-Agent': 'activitypubbot-test/0.0.1'
    }
    const privateKey = await getPrivateKey(signerUser, remoteDomain)
    const method = 'POST'
    const url = nockFormat({ domain: remoteDomain, username: signerUser, obj: 'outbox' })
    const keyId = nockFormat({ domain: remoteDomain, username: signerUser, key: true })
    try {
      await httpSignature.sign({ privateKey, keyId, url, method, headers })
      assert.fail('Expected error not thrown')
    } catch (err) {
      assert.equal(err.name, 'Error')
      assert.equal(err.message, 'Missing header: content-type')
    }
  })

  it('can validate an hs2019 signature', async () => {
    const username = signerUser
    const date = new Date().toUTCString()
    const algorithm = 'hs2019'
    const signature = await nockSignature({
      url: `${origin}/user/${localUser}/outbox`,
      date,
      username,
      domain: remoteDomain,
      algorithm
    })
    const headers = {
      date,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username, remoteDomain)
    const method = 'GET'
    const path = `/user/${localUser}/outbox`
    const result = await httpSignature.validate(publicKeyPem, signature, method, path, headers)
    assert.ok(result)
  })
})
