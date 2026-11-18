import { describe, before, after, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'
import { nockSetup, nockSignature, nockKeyRotate, getPublicKey, getPrivateKey, nockFormat } from '@evanp/activitypub-nock'

import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'
import { signCavage } from './utils/cavage-signature.js'

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

  it('can handle a keyId with arguments', async () => {
    const header = 'keyId="https://guiatributario.net/?author=0#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="uYwm1svAGp+Njb6663o4YywQaAfXhnyvK3ASg0f+FFddFG9ZrlJI4+WYVe+ELcQD/bGEri+TuvZ8bbFsDB2Y+XXx13pcwlBWyG6Lry67+nmqp8U0WykVXlOpI/GkdPtMRY3QSzCMXcKsAWqF3Uljw0wlNRLYeyQ2YrFlKMnT1Vm7u3/4qQVqJAO2Aqu18hUBzYYFe6LyQ9nFh2fCUhbQz0wlYciSEyzdvYRb0YExJhh2a6UvhD1qE0ctImaI1wTsKTgcgXGOGO92iNyvPbotsqHykHZ0cu1YIpOZkhNs3YwYcqxxXypFzh2MEDzoK2b7hrXBAmNpq4MTczEAGLOKlA=="'
    const keyId = httpSignature.keyId(header)
    assert.strictEqual(keyId, 'https://guiatributario.net/?author=0#main-key')
  })

  describe('timestamp pseudo-headers', () => {
    const host = 'signature.example'
    const path = '/inbox?delivery=1'
    const keyId = 'https://sender.example/actor#main-key'
    const created = 1700000000
    const expires = 1700000300
    const headers = { host }
    let verifier
    let privateKey
    let publicKey

    before(async () => {
      verifier = new HTTPSignature(Logger({ level: 'silent' }))
      privateKey = await getPrivateKey(signerUser, remoteDomain)
      publicKey = await getPublicKey(signerUser, remoteDomain)
    })

    for (const [field, value] of [['created', created], ['expires', expires]]) {
      const signingString = `(request-target): get ${path}\n(${field}): ${value}\nhost: ${host}`
      const parameters = `keyId="${keyId}",algorithm="hs2019",headers="(request-target) (${field}) host"`

      for (const [label, parameter] of [['unquoted', `${value}`], ['quoted', `"${value}"`]]) {
        it(`validates hs2019 with ${label} ${field} parameter syntax`, async () => {
          const signature = signCavage(privateKey, signingString, `${parameters},${field}=${parameter}`)
          assert.strictEqual(await verifier.validate(publicKey, signature, 'GET', path, headers), true)
        })
      }

      it(`rejects (${field}) with rsa-sha256 even when an HTTP header supplies its value`, async () => {
        const signature = signCavage(
          privateKey,
          signingString,
          `${parameters.replace('hs2019', 'rsa-sha256')},${field}=${value}`
        )
        await assert.rejects(
          verifier.validate(publicKey, signature, 'GET', path, { ...headers, [`(${field})`]: `${value}` }),
          { status: 401 }
        )
      })

      it(`rejects (${field}) without its Signature parameter despite a matching HTTP header`, async () => {
        const signature = signCavage(privateKey, signingString, parameters)
        await assert.rejects(
          verifier.validate(publicKey, signature, 'GET', path, { ...headers, [`(${field})`]: `${value}` }),
          { status: 401 }
        )
      })

      it(`does not verify when the ${field} Signature parameter is changed`, async () => {
        const signature = signCavage(privateKey, signingString, `${parameters},${field}=${value + 1}`)
        assert.strictEqual(await verifier.validate(publicKey, signature, 'GET', path, headers), false)
      })

      it(`rejects a malformed ${field} parameter despite a matching HTTP header`, async () => {
        const signature = signCavage(privateKey, signingString, `${parameters},${field}="${value}junk"`)
        await assert.rejects(
          verifier.validate(publicKey, signature, 'GET', path, { ...headers, [`(${field})`]: `${value}` }),
          { status: 401 }
        )
      })

      describe(`${field} accessor`, () => {
        for (const [label, parameter] of [['unquoted', `${value}`], ['quoted', `"${value}"`], ['zero', '0']]) {
          it(`returns Unix seconds from a ${label} parameter`, () => {
            const signature = signCavage(privateKey, signingString, `${parameters},${field}=${parameter}`)
            assert.strictEqual(verifier[field](signature), label === 'zero' ? 0 : value)
          })
        }

        it('returns null when the parameter is absent', () => {
          const signature = signCavage(privateKey, signingString, parameters)
          assert.strictEqual(verifier[field](signature), null)
        })

        for (const [label, parameter] of [
          ['non-numeric', '"invalid"'],
          ['partly numeric', `${value}junk`],
          ['empty', '""']
        ]) {
          it(`rejects a ${label} parameter`, () => {
            const signature = signCavage(privateKey, signingString, `${parameters},${field}=${parameter}`)
            assert.throws(() => verifier[field](signature), { status: 401 })
          })
        }

        it('rejects duplicate parameters', () => {
          const signature = signCavage(privateKey, signingString, `${parameters},${field}=${value},${field}=${value + 1}`)
          assert.throws(() => verifier[field](signature), { status: 401 })
        })
      })
    }

    it('validates both timestamp pseudo-headers in the declared signing order', async () => {
      const signingString = `host: ${host}\n(expires): ${expires}\n(request-target): get ${path}\n(created): ${created}`
      const parameters = `keyId="${keyId}",algorithm="hs2019",headers="host (expires) (request-target) (created)",created=${created},expires=${expires}`
      const signature = signCavage(privateKey, signingString, parameters)
      assert.strictEqual(await verifier.validate(publicKey, signature, 'GET', path, headers), true)
    })

    it('takes timestamp values from Signature parameters instead of ordinary HTTP headers', async () => {
      const signingString = `(request-target): get ${path}\n(created): ${created}\n(expires): ${expires}\nhost: ${host}`
      const parameters = `keyId="${keyId}",algorithm="hs2019",headers="(request-target) (created) (expires) host",created=${created},expires=${expires}`
      const signature = signCavage(privateKey, signingString, parameters)
      const spoofedHeaders = {
        ...headers,
        created: `${created + 1}`,
        expires: `${expires + 1}`,
        '(created)': `${created + 2}`,
        '(expires)': `${expires + 2}`
      }
      assert.strictEqual(await verifier.validate(publicKey, signature, 'GET', path, spoofedHeaders), true)
    })

    it('rejects fractional created values', async () => {
      const signingString = `(request-target): get ${path}\n(created): ${created}.5\nhost: ${host}`
      const parameters = `keyId="${keyId}",algorithm="hs2019",headers="(request-target) (created) host",created=${created}.5`
      const signature = signCavage(privateKey, signingString, parameters)
      assert.throws(() => verifier.created(signature), { status: 401 })
      await assert.rejects(verifier.validate(publicKey, signature, 'GET', path, headers), { status: 401 })
    })

    it('rejects an unknown pseudo-header even when an HTTP header supplies its value', async () => {
      const signingString = `(request-target): get ${path}\n(unknown): supplied\nhost: ${host}`
      const parameters = `keyId="${keyId}",algorithm="hs2019",headers="(request-target) (unknown) host"`
      const signature = signCavage(privateKey, signingString, parameters)
      await assert.rejects(
        verifier.validate(publicKey, signature, 'GET', path, { ...headers, '(unknown)': 'supplied' }),
        { status: 401 }
      )
    })
  })
})
