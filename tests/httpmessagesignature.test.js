import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'
import { nockSetup, nockMessageSignature, nockKeyRotate, getPublicKey, getPrivateKey, nockFormat } from '@evanp/activitypub-nock'

import { HTTPMessageSignature } from '../lib/httpmessagesignature.js'
import { Digester } from '../lib/digester.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

describe('HTTPMessageSignature', async () => {
  const domain = 'local.httpmessagesignature.test'
  const remoteDomain = 'social.httpmessagesignature.test'
  const origin = `https://${domain}`
  const localUser = 'httpmessagesignaturetestlocal'
  const signerUser = 'httpmessagesignaturetestsigner'
  const rotateUser = 'httpmessagesignaturetestrotate'
  const testUsernames = [localUser]

  let connection = null
  let httpMessageSignature = null
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
    httpMessageSignature = new HTTPMessageSignature(logger)
    assert.ok(httpMessageSignature)
  })

  it('can validate a signature', async () => {
    const username = signerUser
    const keyId = nockFormat({ username, key: true, domain: remoteDomain })
    const url = `${origin}/user/${localUser}/outbox`
    const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: remoteDomain
    })
    const headers = {
      'signature-input': signatureInput,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username, remoteDomain)
    const method = 'GET'
    const result = await httpMessageSignature.validate(publicKeyPem, signatureInput, signature, method, url, headers)
    assert.ok(result)
  })

  it('can validate a signature on a URL with a query string', async () => {
    const username = signerUser
    const lname = localUser
    const keyId = nockFormat({ username, key: true, domain: remoteDomain })
    const url = `${origin}/.well-known/webfinger?resource=acct:${lname}@${domain}`
    const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: remoteDomain
    })
    const headers = {
      'signature-input': signatureInput,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username, remoteDomain)
    const method = 'GET'
    const result = await httpMessageSignature.validate(publicKeyPem, signatureInput, signature, method, url, headers)
    assert.ok(result)
  })

  it('can handle key rotation', async () => {
    const username = rotateUser
    const keyId = nockFormat({ username, key: true, domain: remoteDomain })
    const url = `${origin}/user/${localUser}/outbox`
    const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: remoteDomain
    })
    const headers = {
      'signature-input': signatureInput,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username, remoteDomain)
    const method = 'GET'
    await httpMessageSignature.validate(publicKeyPem, signatureInput, signature, method, url, headers)
    await nockKeyRotate(username, remoteDomain)
    const { 'signature-input': signatureInput2, signature: signature2 } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: remoteDomain
    })
    const headers2 = {
      'signature-input': signatureInput2,
      signature: signature2,
      host: URL.parse(origin).host
    }
    const publicKeyPem2 = await getPublicKey(username, remoteDomain)
    assert.notStrictEqual(publicKeyPem, publicKeyPem2)
    const result2 = await httpMessageSignature.validate(publicKeyPem2, signatureInput2, signature2, method, url, headers2)
    assert.ok(result2)
  })

  it('can validate a signature with a fragment key URL', async () => {
    const username = signerUser
    const keyId = nockFormat({ username, domain: remoteDomain }) + '#main-key'
    const url = `${origin}/user/${localUser}/outbox`
    const { 'signature-input': signatureInput, signature } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: remoteDomain
    })
    const headers = {
      'signature-input': signatureInput,
      signature,
      host: URL.parse(origin).host
    }
    const publicKeyPem = await getPublicKey(username, remoteDomain)
    const method = 'GET'
    const result = await httpMessageSignature.validate(publicKeyPem, signatureInput, signature, method, url, headers)
    assert.ok(result)
  })

  it('can extract a keyId from a signature-input header', async () => {
    const username = signerUser
    const keyId = nockFormat({ username, key: true, domain: remoteDomain })
    const url = `${origin}/user/${localUser}/outbox`
    const { 'signature-input': signatureInput } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: remoteDomain
    })
    const result = httpMessageSignature.keyId(signatureInput)
    assert.equal(result, keyId)
  })

  it('can extract a fragment keyId from a signature-input header', async () => {
    const username = signerUser
    const keyId = nockFormat({ username, domain: remoteDomain }) + '#main-key'
    const url = `${origin}/user/${localUser}/outbox`
    const { 'signature-input': signatureInput } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: remoteDomain
    })
    const result = httpMessageSignature.keyId(signatureInput)
    assert.equal(result, keyId)
  })

  it('can extract a created timestamp from a signature-input header', async () => {
    const username = signerUser
    const keyId = nockFormat({ username, key: true, domain: remoteDomain })
    const url = `${origin}/user/${localUser}/outbox`
    const before = Math.floor(Date.now() / 1000)
    const { 'signature-input': signatureInput } = await nockMessageSignature({
      url,
      username,
      keyId,
      domain: remoteDomain
    })
    const after = Math.floor(Date.now() / 1000)
    const result = httpMessageSignature.created(signatureInput)
    assert.ok(result >= before)
    assert.ok(result <= after)
  })

  it('can sign a GET request', async () => {
    const headers = {}
    const privateKey = await getPrivateKey(signerUser, remoteDomain)
    const method = 'GET'
    const url = `${origin}/user/${localUser}/outbox`
    const keyId = nockFormat({ domain: remoteDomain, username: signerUser, key: true })
    const result = await httpMessageSignature.sign({ privateKey, keyId, url, method, headers })
    assert.ok(result)
    assert.ok(result['signature-input'])
    assert.ok(result['signature-input'].match(/sig1=\("@method" "@authority" "@path"\)/))
    assert.ok(result['signature-input'].match(/alg="rsa-v1_5-sha256"/))
    assert.ok(result['signature-input'].match(/created=\d+/))
    assert.ok(result.signature)
    assert.ok(result.signature.match(/^sig1=:.+:$/))
  })

  it('can sign a GET request with a query string', async () => {
    const lname = localUser
    const headers = {}
    const privateKey = await getPrivateKey(signerUser, remoteDomain)
    const method = 'GET'
    const url = `${origin}/.well-known/webfinger?resource=acct:${lname}@${domain}`
    const keyId = nockFormat({ domain: remoteDomain, username: signerUser, key: true })
    const result = await httpMessageSignature.sign({ privateKey, keyId, url, method, headers })
    assert.ok(result)
    assert.ok(result['signature-input'].match(/sig1=\("@method" "@authority" "@path" "@query"\)/))
    assert.ok(result['signature-input'].match(/alg="rsa-v1_5-sha256"/))
    assert.ok(result.signature)
    assert.ok(result.signature.match(/^sig1=:.+:$/))
  })

  it('can sign a POST request', async () => {
    const body = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      actor: nockFormat({ domain: remoteDomain, username: signerUser }),
      object: nockFormat({ domain: remoteDomain, username: signerUser, obj: 'note', num: 1 })
    })
    const contentDigest = await digester.contentDigest(body)
    const headers = {
      'content-digest': contentDigest
    }
    const privateKey = await getPrivateKey(signerUser, remoteDomain)
    const method = 'POST'
    const url = `${origin}/user/${localUser}/inbox`
    const keyId = nockFormat({ domain: remoteDomain, username: signerUser, key: true })
    const result = await httpMessageSignature.sign({ privateKey, keyId, url, method, headers })
    assert.ok(result)
    assert.ok(result['signature-input'].match(/sig1=\("@method" "@authority" "@path" "content-digest"\)/))
    assert.ok(result.signature)
    assert.ok(result.signature.match(/^sig1=:.+:$/))
  })
})
