import { describe, it, before, after, beforeEach } from 'node:test'
import { ActorStorage } from '../lib/actorstorage.js'
import { Sequelize } from 'sequelize'
import { UrlFormatter } from '../lib/urlformatter.js'
import as2 from '../lib/activitystreams.js'
import {
  nockSetup,
  nockFormat,
  postInbox,
  getRequestHeaders,
  resetInbox,
  resetRequestHeaders,
  getBody,
  resetBodies,
  postSharedInbox,
  resetSharedInbox
} from '@evanp/activitypub-nock'
import { KeyStorage } from '../lib/keystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import assert from 'node:assert'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import Logger from 'pino'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'
import { runMigrations } from '../lib/migrations/index.js'

describe('ActivityDistributor', () => {
  let connection = null
  let actorStorage = null
  let keyStorage = null
  let formatter = null
  let client = null
  let distributor = null
  let logger = null
  before(async () => {
    logger = Logger({ level: 'silent' })
    formatter = new UrlFormatter('https://activitypubbot.example')
    connection = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    await connection.authenticate()
    await runMigrations(connection)
    actorStorage = new ActorStorage(connection, formatter)
    keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    const actor2 = await as2.import({
      id: nockFormat({ domain: 'social.example', username: 'test1' })
    })
    const actor3 = await as2.import({
      id: nockFormat({ domain: 'other.example', username: 'test2' })
    })
    const actor4 = await as2.import({
      id: nockFormat({ domain: 'social.example', username: 'test4' })
    })
    const actor5 = await as2.import({
      id: nockFormat({ domain: 'other.example', username: 'test5' })
    })
    await actorStorage.addToCollection('test0', 'followers', actor2)
    await actorStorage.addToCollection('test0', 'followers', actor3)
    await actorStorage.addToCollection('test0', 'following', actor4)
    await actorStorage.addToCollection('test0', 'following', actor5)
    nockSetup('social.example')
    nockSetup('other.example')
    nockSetup('third.example')
    nockSetup('shared.example', { sharedInbox: true })
    nockSetup('flaky.example', { flaky: true })
  })
  after(async () => {
    await connection.close()
    distributor = null
    client = null
    connection = null
    actorStorage = null
    keyStorage = null
    formatter = null
    logger = null
  })
  beforeEach(async () => {
    resetInbox()
    resetRequestHeaders()
    resetBodies()
    resetSharedInbox()
  })
  it('can create an instance', () => {
    distributor = new ActivityDistributor(client, formatter, actorStorage, logger)
    assert.ok(distributor instanceof ActivityDistributor)
  })
  it('can distribute an activity to a single recipient', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/1',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: ['https://social.example/user/test1']
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.equal(postInbox.test1, 1)
    assert.ok(!postInbox.test2)
    const { signature, digest, date } =
      getRequestHeaders('https://social.example/user/test1/inbox')
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, /^keyId="https:\/\/activitypubbot\.example\/user\/test0\/publickey",headers="\(request-target\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$/)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
  })
  it('can distribute an activity to all followers', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/2',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: ['https://activitypubbot.example/user/test0/followers']
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    const { signature, digest, date } =
      getRequestHeaders('https://social.example/user/test1/inbox')
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, /^keyId="https:\/\/activitypubbot\.example\/user\/test0\/publickey",headers="\(request-target\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$/)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
  })
  it('can distribute an activity to the public', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/3',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: ['https://www.w3.org/ns/activitystreams#Public']
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(!postInbox.test1)
    assert.ok(!postInbox.test2)
  })
  it('can distribute an activity to an addressed actor and followers', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/4',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: ['https://social.example/user/test1'],
      cc: ['https://activitypubbot.example/user/test0/followers']
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(postInbox.test1)
    assert.ok(postInbox.test2)
    const { signature, digest, date } =
      getRequestHeaders('https://social.example/user/test1/inbox')
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, /^keyId="https:\/\/activitypubbot\.example\/user\/test0\/publickey",headers="\(request-target\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$/)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
  })
  it('can distribute an activity to an addressed actor and the public', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/5',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: ['https://social.example/user/test1'],
      cc: ['https://www.w3.org/ns/activitystreams#Public']
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(postInbox.test1)
    assert.ok(!postInbox.test2)
    const { signature, digest, date } =
      getRequestHeaders('https://social.example/user/test1/inbox')
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, /^keyId="https:\/\/activitypubbot\.example\/user\/test0\/publickey",headers="\(request-target\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$/)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
  })
  it('only sends once to an addressed follower', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/6',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: ['https://other.example/user/test2'],
      cc: ['https://activitypubbot.example/user/test0/followers']
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.equal(postInbox.test2, 1)
  })
  it('does not send bcc or bto over the wire', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/8',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      bto: ['https://other.example/user/test2'],
      bcc: ['https://third.example/user/test3']
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.equal(postInbox.test2, 1)
    assert.equal(postInbox.test3, 1)
    const body = getBody('https://other.example/user/test2/inbox')
    assert.ok(!body.match(/bcc/))
    assert.ok(!body.match(/bto/))
  })
  it('posts once to a shared inbox', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1)
    const remotes = nums.map(n => `https://shared.example/user/test${n}`)
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/9',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: remotes
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.equal(postSharedInbox['shared.example'], 1)
    for (const i of nums) {
      assert.ok(!postInbox[`test${i}`])
    }
  })
  it('uses the cache for sending again to same actors', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1)
    const remotes = nums.map(n => `https://shared.example/user/test${n}`)
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/10',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: remotes
    })
    assert.equal(postSharedInbox['shared.example'], 0)
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.equal(postSharedInbox['shared.example'], 1)
    for (const i of nums) {
      const headers = getRequestHeaders(`https://shared.example/user/test${i}`)
      assert.ok(!headers)
    }
  })
  it('distributes directly for addressees in bto', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1)
    const remotes = nums.map(n => `https://shared.example/user/test${n}`)
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/11',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      bto: remotes
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(!postSharedInbox['shared.example'])
    for (const i of nums) {
      assert.equal(postInbox[`test${i}`], 1, `did not distribute directly to test${i}`)
    }
  })
  it('distributes directly for addressees in bto a second time', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1)
    const remotes = nums.map(n => `https://shared.example/user/test${n}`)
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/12',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      bto: remotes
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(!postSharedInbox['shared.example'])
    for (const i of nums) {
      assert.equal(postInbox[`test${i}`], 1, `did not distribution directly to test${i}`)
    }
  })
  it('distributes directly for addressees in bcc', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1).map(n => n + 100)
    const remotes = nums.map(n => `https://shared.example/user/test${n}`)
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/13',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      bcc: remotes
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(!postSharedInbox['shared.example'])
    for (const i of nums) {
      assert.equal(postInbox[`test${i}`], 1, `did not distribution directly to test${i}`)
    }
  })
  it('distributes directly for addressees in bcc a second time', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1).map(n => n + 100)
    const remotes = nums.map(n => `https://shared.example/user/test${n}`)
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/14',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      bcc: remotes
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(!postSharedInbox['shared.example'])
    for (const i of nums) {
      assert.equal(postInbox[`test${i}`], 1, `did not distribution directly to test${i}`)
    }
  })
  it('retries distribution to a flaky recipient', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/15',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: ['https://flaky.example/user/flaky1']
    })
    try {
      await distributor.distribute(activity, 'test0')
    } catch (error) {
      assert.fail(`Error in distribution: ${error.message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
    assert.equal(postInbox['flaky1'], 1)
  })
  it('can distribute a single activity to a local account', async () => {
    const id = formatter.format({
      username: 'test0',
      type: 'intransitiveactivity',
      nanoid: 'Ca45kO_L7haXDXWdqoWHE'
    })
    const activity = await as2.import({
      id,
      type: 'IntransitiveActivity',
      actor: formatter.format({ username: 'test0' }),
      to: formatter.format({ username: 'test1' })
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(await actorStorage.isInCollection(
      'test1',
      'inbox',
      activity
    ))
  })
  it('will not distribute an activity to the actor', async () => {
    const id = formatter.format({
      username: 'test0',
      type: 'intransitiveactivity',
      nanoid: 'ubiKNmJow3A_D52IZOsRL'
    })
    const activity = await as2.import({
      id,
      type: 'IntransitiveActivity',
      actor: formatter.format({ username: 'test0' }),
      to: formatter.format({ username: 'test0' })
    })
    // Add to inbox and outbox to simulate real activity generation
    await actorStorage.addToCollection('test0', 'inbox', activity)
    await actorStorage.addToCollection('test0', 'outbox', activity)
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(await actorStorage.isInCollection(
      'test0',
      'inbox',
      activity
    ))
  })
  it('can distribute an activity to local following collection', async () => {
    const id = formatter.format({
      username: 'test0',
      type: 'intransitiveactivity',
      nanoid: '32GwjbnzIo6dzoicvlETu'
    })
    const activity = await as2.import({
      id,
      type: 'IntransitiveActivity',
      actor: formatter.format({ username: 'test0' }),
      to: formatter.format({ username: 'test0', collection: 'following' })
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.ok(postInbox.test4)
    assert.ok(postInbox.test5)
    const { signature, digest, date } =
      getRequestHeaders('https://social.example/user/test4/inbox')
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, /^keyId="https:\/\/activitypubbot\.example\/user\/test0\/publickey",headers="\(request-target\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$/)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
  })
})
