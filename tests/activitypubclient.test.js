import { describe, before, after, it, beforeEach } from 'node:test'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import assert from 'node:assert'
import { Sequelize } from 'sequelize'
import as2 from '../lib/activitystreams.js'
import Logger from 'pino'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'
import { runMigrations } from '../lib/migrations/index.js'
import {
  nockSetup,
  getRequestHeaders,
  resetRequestHeaders,
  addToCollection,
  nockFormat
} from './utils/nock.js'

describe('ActivityPubClient', async () => {
  let connection = null
  let keyStorage = null
  let formatter = null
  let client = null
  let signer = null
  let digester = null
  let logger = null
  const remoteUser = 'remote1'
  const remoteCollection = 1
  const remoteOrderedCollection = 2
  const maxItems = 10
  before(async () => {
    logger = new Logger({
      level: 'debug'
    })
    digester = new Digester(logger)
    signer = new HTTPSignature(logger)
    connection = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    await connection.authenticate()
    await runMigrations(connection)
    keyStorage = new KeyStorage(connection, logger)
    formatter = new UrlFormatter('https://activitypubbot.example')
    const remote = 'social.example'
    nockSetup(remote)
    for (let i = 0; i < maxItems; i++) {
      const id = nockFormat({ username: remoteUser, type: 'note', num: i })
      addToCollection(remoteUser, remoteCollection, id, remote)
    }
    for (let i = maxItems; i < 2 * maxItems; i++) {
      const id = nockFormat({ username: remoteUser, type: 'note', num: i })
      addToCollection(remoteUser, remoteOrderedCollection, id, remote)
    }
  })
  after(async () => {
    await connection.close()
    keyStorage = null
    connection = null
    formatter = null
    client = null
    logger = null
    digester = null
    signer = null
  })
  beforeEach(async () => {
    resetRequestHeaders()
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
    const h = getRequestHeaders(id)
    assert.ok(h.signature)
    assert.match(h.signature, /^keyId="https:\/\/activitypubbot\.example\/user\/foobot\/publickey",headers="\(request-target\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$/)
    assert.equal(typeof h.digest, 'undefined')
    assert.equal(typeof h.date, 'string')
    assert.match(h.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(h.date)
    })
  })
  it('can get a remote object without a username', async () => {
    const id = 'https://social.example/user/evan/note/1'
    const obj = await client.get(id)
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.equal(obj.id, id)
    const h = getRequestHeaders(id)
    assert.ok(h.signature)
    assert.match(h.signature, /^keyId="https:\/\/activitypubbot\.example\/publickey",headers="\(request-target\) host date user-agent accept",signature=".*",algorithm="rsa-sha256"$/)
    assert.equal(typeof h.digest, 'undefined')
    assert.equal(typeof h.date, 'string')
    assert.match(h.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(h.date)
    })
  })
  it('can get a remote key without a signature', async () => {
    const id = 'https://social.example/user/evan/publickey'
    const obj = await client.getKey(id)
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.equal(obj.id, id)
    const h = getRequestHeaders(id)
    assert.equal(h.signature, undefined)
    assert.equal(typeof h.digest, 'undefined')
    assert.equal(typeof h.date, 'string')
    assert.match(h.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(h.date)
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
    const h = getRequestHeaders(inbox)
    assert.ok(h.signature)
    assert.ok(h.digest)
    assert.match(h.signature, /^keyId="https:\/\/activitypubbot\.example\/user\/foobot\/publickey",headers="\(request-target\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$/)
    assert.match(h.digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.equal(typeof h.date, 'string')
    assert.match(h.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
    assert.doesNotThrow(() => {
      Date.parse(h.date)
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
  it('can iterate over a Collection', async () => {
    const collectionUri = nockFormat({
      username: remoteUser,
      type: 'Collection',
      num: remoteCollection
    })
    let counter = 0
    for await (const item of client.items(collectionUri)) {
      assert.ok(item)
      counter = counter + 1
    }
    assert.strictEqual(counter, maxItems)
  })
  it('can iterate over an OrderedCollection', async () => {
    const collectionUri = nockFormat({
      username: remoteUser,
      type: 'OrderedCollection',
      num: remoteOrderedCollection
    })
    let counter = 0
    for await (const item of client.items(collectionUri)) {
      assert.ok(item)
      counter = counter + 1
    }
    assert.strictEqual(counter, maxItems)
  })
})
