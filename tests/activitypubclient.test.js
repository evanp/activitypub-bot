import { describe, before, after, it, beforeEach } from 'node:test'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import assert from 'node:assert'
import { Sequelize } from 'sequelize'
import nock from 'nock'
import as2 from 'activitystrea.ms'
import Logger from 'pino'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'

const makeActor = (username) =>
  as2.import({
    id: `https://social.example/user/${username}`,
    type: 'Person',
    preferredUsername: username,
    inbox: `https://social.example/user/${username}/inbox`,
    outbox: `https://social.example/user/${username}/outbox`,
    followers: `https://social.example/user/${username}/followers`,
    following: `https://social.example/user/${username}/following`,
    liked: `https://social.example/user/${username}/liked`,
    publicKey: {
      id: `https://social.example/user/${username}/publickey`,
      owner: `https://social.example/user/${username}`,
      type: 'CryptographicKey',
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nFAKEFAKEFAKE\n-----END PUBLIC KEY-----'
    }
  })

const makeKey = (username) =>
  as2.import({
    id: `https://social.example/user/${username}/publickey`,
    owner: `https://social.example/user/${username}`,
    type: 'CryptographicKey',
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nFAKEFAKEFAKE\n-----END PUBLIC KEY-----'
  })

const makeNote = (username, num) =>
  as2.import({
    id: `https://social.example/user/${username}/note/${num}`,
    type: 'Object',
    attributedTo: `https://social.example/user/${username}`,
    to: 'https://www.w3.org/ns/activitystreams#Public',
    content: `This is note ${num} by ${username}.`
  })

describe('ActivityPubClient', async () => {
  let connection = null
  let keyStorage = null
  let formatter = null
  let client = null
  let postInbox = null
  let signature = null
  let digest = null
  let date = null
  let signer = null
  let digester = null
  let logger = null
  before(async () => {
    logger = new Logger({
      level: 'silent'
    })
    digester = new Digester(logger)
    signer = new HTTPSignature(logger)
    connection = new Sequelize('sqlite::memory:', { logging: false })
    await connection.authenticate()
    keyStorage = new KeyStorage(connection)
    await keyStorage.initialize()
    formatter = new UrlFormatter('https://activitypubbot.example')
    const remote = 'https://social.example'
    nock(remote)
      .get(/\/user\/(\w+)$/)
      .reply(async function (uri, requestBody) {
        const headers = this.req.headers
        signature[remote + uri] = headers.signature
        digest[remote + uri] = headers.digest
        date[remote + uri] = headers.date
        const username = uri.match(/\/user\/(\w+)$/)[1]
        const actor = await makeActor(username)
        const actorText = await actor.write()
        return [200, actorText, { 'Content-Type': 'application/activity+json' }]
      })
      .persist()
      .post(/\/user\/(\w+)\/inbox$/)
      .reply(async function (uri, requestBody) {
        const headers = this.req.headers
        signature[remote + uri] = headers.signature
        digest[remote + uri] = headers.digest
        date[remote + uri] = headers.date
        const username = uri.match(/\/user\/(\w+)\/inbox$/)[1]
        if (username in postInbox) {
          postInbox[username] += 1
        } else {
          postInbox[username] = 1
        }
        return [202, 'accepted']
      })
      .persist()
      .get(/\/user\/(\w+)\/note\/(\d+)$/)
      .reply(async function (uri, requestBody) {
        const headers = this.req.headers
        signature[remote + uri] = headers.signature
        digest[remote + uri] = headers.digest
        date[remote + uri] = headers.date
        const match = uri.match(/\/user\/(\w+)\/note\/(\d+)$/)
        const username = match[1]
        const num = match[2]
        const obj = await makeNote(username, num)
        const objText = await obj.write()
        return [200, objText, { 'Content-Type': 'application/activity+json' }]
      })
      .get(/\/user\/(\w+)\/inbox$/)
      .reply(async function (uri, requestBody) {
        return [403, 'Forbidden', { 'Content-Type': 'text/plain' }]
      })
      .get(/\/user\/(\w+)\/publickey$/)
      .reply(async function (uri, requestBody) {
        const headers = this.req.headers
        signature[remote + uri] = headers.signature
        digest[remote + uri] = headers.digest
        date[remote + uri] = headers.date
        const username = uri.match(/\/user\/(\w+)\/publickey$/)[1]
        const key = await makeKey(username)
        const keyText = await key.write()
        return [200, keyText, { 'Content-Type': 'application/activity+json' }]
      })
      .persist()
  })
  after(async () => {
    await connection.close()
    keyStorage = null
    connection = null
    formatter = null
    client = null
    postInbox = null
    signature = null
    logger = null
    digester = null
    signer = null
  })
  beforeEach(async () => {
    signature = {}
    digest = {}
    postInbox = {}
    date = {}
  })
  it('can initialize', () => {
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    assert.ok(client)
  })
  it('can get a remote object with a username', async () => {
    const id = 'https://social.example/user/evan/note/1'
    const obj = await client.get(id, 'foobot')
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.equal(obj.id, id)
    assert.ok(signature[id])
    assert.match(signature[id], /^keyId="https:\/\/activitypubbot\.example\/user\/foobot\/publickey",headers="\(request-target\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$/)
    assert.equal(typeof digest[id], 'undefined')
    assert.equal(typeof date[id], 'string')
    assert.match(date[id], /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(date[id])
    })
  })
  it('can get a remote object without a username', async () => {
    const id = 'https://social.example/user/evan/note/1'
    const obj = await client.get(id)
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.equal(obj.id, id)
    assert.ok(signature[id])
    assert.match(signature[id], /^keyId="https:\/\/activitypubbot\.example\/publickey",headers="\(request-target\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$/)
    assert.equal(typeof digest[id], 'undefined')
    assert.equal(typeof date[id], 'string')
    assert.match(date[id], /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(date[id])
    })
  })
  it('can get a remote key without a signature', async () => {
    const id = 'https://social.example/user/evan/publickey'
    const obj = await client.getKey(id)
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.equal(obj.id, id)
    assert.equal(signature[id], undefined)
    assert.equal(typeof digest[id], 'undefined')
    assert.equal(typeof date[id], 'string')
    assert.match(date[id], /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(date[id])
    })
  })
  it('can deliver an activity', async () => {
    const obj = as2.follow()
      .actor('https://activitypubbot.example/user/foobot')
      .object('https://social.example/user/evan')
      .to('https://social.example/user/evan')
      .publishedNow()
      .get()
    const inbox = 'https://social.example/user/evan/inbox'
    await client.post(inbox, obj, 'foobot')
    assert.ok(signature[inbox])
    assert.ok(digest[inbox])
    assert.match(signature[inbox], /^keyId="https:\/\/activitypubbot\.example\/user\/foobot\/publickey",headers="\(request-target\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$/)
    assert.match(digest[inbox], /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.equal(typeof date[inbox], 'string')
    assert.match(date[inbox], /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(date[inbox])
    })
  })
  it('throws an error on a non-2xx response', async () => {
    const inbox = 'https://social.example/user/evan/inbox'
    try {
      await client.get(inbox, 'foobot')
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error)
      assert.equal(error.status, 403)
    }
  })
})
