import { describe, it, before, after, beforeEach } from 'node:test'
import { ActorStorage } from '../lib/actorstorage.js'
import { Sequelize } from 'sequelize'
import { UrlFormatter } from '../lib/urlformatter.js'
import as2 from 'activitystrea.ms'
import nock from 'nock'
import { KeyStorage } from '../lib/keystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import assert from 'node:assert'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import Logger from 'pino'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'

const makeActor = (domain, username, shared = true) =>
  as2.import({
    id: `https://${domain}/user/${username}`,
    type: 'Person',
    preferredUsername: username,
    inbox: `https://${domain}/user/${username}/inbox`,
    outbox: `https://${domain}/user/${username}/outbox`,
    followers: `https://${domain}/user/${username}/followers`,
    following: `https://${domain}/user/${username}/following`,
    liked: `https://${domain}/user/${username}/liked`,
    endpoints: {
      sharedInbox: (shared) ? `https://${domain}/sharedInbox` : null
    }
  })

const makeObject = (domain, username, num) =>
  as2.import({
    id: `https://${domain}/user/${username}/object/${num}`,
    type: 'Object',
    attributedTo: `https://${domain}/user/${username}`,
    to: 'https://www.w3.org/ns/activitystreams#Public'
  })

describe('ActivityDistributor', () => {
  let connection = null
  let actorStorage = null
  let keyStorage = null
  let formatter = null
  let client = null
  let distributor = null
  let actor1 = null
  let actor2 = null
  let actor3 = null
  let signature = null
  let digest = null
  let date = null
  let gotTest1 = 0
  let gotTest2 = 0
  let postedTest1Inbox = 0
  let postedTest2Inbox = 0
  let postedTest3Inbox = 0
  let btoSeen = 0
  let bccSeen = 0
  let postInbox = {}
  let postSignature = null
  let postSharedInbox = {}
  let getActor = {}
  let logger = null
  before(async () => {
    logger = Logger({ level: 'silent' })
    formatter = new UrlFormatter('https://activitypubbot.example')
    connection = new Sequelize('sqlite::memory:', { logging: false })
    await connection.authenticate()
    actorStorage = new ActorStorage(connection, formatter)
    await actorStorage.initialize()
    keyStorage = new KeyStorage(connection, logger)
    await keyStorage.initialize()
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    actor1 = await as2.import({
      id: 'https://social.example/user/test1',
      type: 'Person',
      preferredUsername: 'test1',
      inbox: 'https://social.example/user/test1/inbox',
      outbox: 'https://social.example/user/test1/outbox',
      followers: 'https://social.example/user/test1/followers',
      following: 'https://social.example/user/test1/following',
      liked: 'https://social.example/user/test1/liked'
    })
    const actor1Text = await actor1.export()
    actor2 = await as2.import({
      id: 'https://other.example/user/test2',
      type: 'Person',
      preferredUsername: 'test2',
      inbox: 'https://other.example/user/test2/inbox',
      outbox: 'https://other.example/user/test2/outbox',
      followers: 'https://other.example/user/test2/followers',
      following: 'https://other.example/user/test2/following',
      liked: 'https://other.example/user/test2/liked'
    })
    const actor2Text = await actor2.export()
    actor3 = await as2.import({
      id: 'https://third.example/user/test3',
      type: 'Person',
      preferredUsername: 'test3',
      inbox: 'https://third.example/user/test3/inbox',
      outbox: 'https://third.example/user/test3/outbox',
      followers: 'https://third.example/user/test3/followers',
      following: 'https://third.example/user/test3/following',
      liked: 'https://third.example/user/test3/liked'
    })
    const actor3Text = await actor3.export()
    await actorStorage.addToCollection('test0', 'followers', actor2)
    await actorStorage.addToCollection('test0', 'followers', actor3)
    nock('https://social.example')
      .get('/user/test1')
      .reply(function (uri, requestBody) {
        gotTest1 += 1
        signature = this.req.headers.signature
        digest = this.req.headers.digest
        date = this.req.headers.date
        return [200, actor1Text,
          { 'Content-Type': 'application/activity+json' }]
      })
      .persist()
      .post('/user/test1/inbox')
      .reply(function (uri, requestBody) {
        postedTest1Inbox += 1
        postSignature = signature = this.req.headers.signature
        digest = this.req.headers.digest
        date = this.req.headers.date
        return [202, 'accepted']
      })
      .persist()
    nock('https://other.example')
      .get('/user/test2')
      .reply(function (uri, requestBody) {
        gotTest2 += 1
        signature = this.req.headers.signature
        digest = this.req.headers.digest
        date = this.req.headers.date
        return [200, actor2Text,
          { 'Content-Type': 'application/activity+json' }]
      })
      .persist()
      .post('/user/test2/inbox')
      .reply(function (uri, requestBody) {
        postedTest2Inbox += 1
        const obj = JSON.parse(requestBody)
        if (obj.bcc) {
          bccSeen += 1
        }
        if (obj.bto) {
          btoSeen += 1
        }
        postSignature = signature = this.req.headers.signature
        digest = this.req.headers.digest
        date = this.req.headers.date
        return [202, 'accepted']
      })
      .persist()
    nock('https://third.example')
      .get('/user/test3')
      .reply(function (uri, requestBody) {
        return [200, actor3Text,
          { 'Content-Type': 'application/activity+json' }]
      })
      .persist()
      .post('/user/test3/inbox')
      .reply(function (uri, requestBody) {
        postedTest3Inbox += 1
        const obj = JSON.parse(requestBody)
        if (obj.bcc) {
          bccSeen += 1
        }
        if (obj.bto) {
          btoSeen += 1
        }
        postSignature = signature = this.req.headers.signature
        digest = this.req.headers.digest
        date = this.req.headers.date
        return [202, 'accepted']
      })
      .persist()
    nock('https://shared.example')
      .get(/\/user\/(\w+)$/)
      .reply(async function (uri, requestBody) {
        const username = uri.match(/\/user\/(\w+)$/)[1]
        if (username in postInbox) {
          getActor[username] += 1
        } else {
          getActor[username] = 1
        }
        const actor = await makeActor('shared.example', username)
        const actorText = await actor.write()
        return [200, actorText, { 'Content-Type': 'application/activity+json' }]
      })
      .persist()
      .post(/\/user\/(\w+)\/inbox$/)
      .reply(async function (uri, requestBody) {
        const username = uri.match(/\/user\/(\w+)\/inbox$/)[1]
        if (username in postInbox) {
          postInbox[username] += 1
        } else {
          postInbox[username] = 1
        }
        postSignature = signature = this.req.headers.signature
        digest = this.req.headers.digest
        date = this.req.headers.date
        return [202, 'accepted']
      })
      .persist()
      .post(/\/sharedInbox$/)
      .reply(async function (uri, requestBody) {
        const domain = 'shared.example'
        if (domain in postSharedInbox) {
          postSharedInbox[domain] += 1
        } else {
          postSharedInbox[domain] = 1
        }
        postSignature = signature = this.req.headers.signature
        digest = this.req.headers.digest
        date = this.req.headers.date
        return [202, 'accepted']
      })
      .persist()
      .get(/\/user\/(\w+)\/object\/(\d+)$/)
      .reply(async function (uri, requestBody) {
        const match = uri.match(/\/user\/(\w+)\/object\/(\d+)$/)
        const username = match[1]
        const num = match[2]
        const obj = await makeObject('shared.example', username, num)
        const objText = await obj.write()
        postSignature = signature = this.req.headers.signature
        digest = this.req.headers.digest
        date = this.req.headers.date
        return [200, objText, { 'Content-Type': 'application/activity+json' }]
      })
      .persist()

    nock('https://flaky.example')
      .get(/\/user\/(\w+)$/)
      .reply(async function (uri, requestBody) {
        const username = uri.match(/\/user\/(\w+)$/)[1]
        if (username in postInbox) {
          getActor[username] += 1
        } else {
          getActor[username] = 1
        }
        const actor = await makeActor('flaky.example', username)
        const actorText = await actor.write()
        return [200, actorText, { 'Content-Type': 'application/activity+json' }]
      })
      .persist()
      .post(/\/user\/(\w+)\/inbox$/)
      .reply(async function (uri, requestBody) {
        const username = uri.match(/\/user\/(\w+)\/inbox$/)[1]
        if (username in postInbox) {
          postInbox[username] += 1
          return [202, 'accepted']
        } else {
          postInbox[username] = 0
          return [503, 'service unavailable']
        }
      })
      .persist()
      .post(/\/sharedInbox$/)
      .reply(async function (uri, requestBody) {
        const domain = 'flaky.example'
        if (domain in postSharedInbox) {
          postSharedInbox[domain] += 1
          return [202, 'accepted']
        } else {
          postSharedInbox[domain] = 0
          return [503, 'service unavailable']
        }
      })
      .persist()
      .get(/\/user\/(\w+)\/object\/(\d+)$/)
      .reply(async function (uri, requestBody) {
        const match = uri.match(/\/user\/(\w+)\/object\/(\d+)$/)
        const username = match[1]
        const num = match[2]
        const obj = await makeObject('flaky.example', username, num)
        const objText = await obj.write()
        return [200, objText, { 'Content-Type': 'application/activity+json' }]
      })
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
    signature = null
    digest = null
    gotTest1 = 0
    gotTest2 = 0
    postedTest1Inbox = 0
    postedTest2Inbox = 0
    postedTest3Inbox = 0
    btoSeen = 0
    bccSeen = 0
    postInbox = {}
    postSharedInbox = {}
    getActor = {}
    postSignature = null
    digest = null
    date = null
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
    assert.equal(gotTest1, 1)
    assert.equal(postedTest1Inbox, 1)
    assert.equal(postedTest2Inbox, 0)
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
    assert.equal(postedTest1Inbox, 0)
    assert.equal(gotTest2, 1)
    assert.equal(postedTest2Inbox, 1)
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
    assert.equal(postedTest1Inbox, 0)
    assert.equal(postedTest2Inbox, 1)
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, /^keyId="https:\/\/activitypubbot\.example\/user\/test0\/publickey",headers="\(request-target\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$/)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
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
    assert.equal(postedTest1Inbox, 1)
    assert.equal(postedTest2Inbox, 1)
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
    assert.equal(postedTest1Inbox, 1)
    assert.equal(postedTest2Inbox, 1)
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
    assert.equal(postedTest1Inbox, 0)
    assert.equal(postedTest2Inbox, 1)
  })
  it('only sends once to an addressed follower for the public', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/7',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: ['https://other.example/user/test2'],
      cc: ['https://www.w3.org/ns/activitystreams#Public']
    })
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.equal(postedTest1Inbox, 0)
    assert.equal(postedTest2Inbox, 1)
    assert.ok(postSignature)
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
    assert.equal(postedTest2Inbox, 1)
    assert.equal(postedTest3Inbox, 1)
    assert.equal(bccSeen, 0, 'bcc should not be seen')
    assert.equal(btoSeen, 0, 'bto should not be seen')
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
      assert.equal(getActor[`test${i}`], 1)
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
    await distributor.distribute(activity, 'test0')
    await distributor.onIdle()
    assert.equal(postSharedInbox['shared.example'], 1)
    for (const i of nums) {
      assert.ok(!getActor[`test${i}`])
    }
  })
  it('delivers directly for addressees in bto', async () => {
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
      assert.equal(postInbox[`test${i}`], 1, `did not delivery directly to test${i}`)
    }
  })
  it('delivers directly for addressees in bto a second time', async () => {
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
      assert.equal(postInbox[`test${i}`], 1, `did not delivery directly to test${i}`)
    }
  })
  it('delivers directly for addressees in bcc', async () => {
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
      assert.equal(postInbox[`test${i}`], 1, `did not delivery directly to test${i}`)
    }
  })
  it('delivers directly for addressees in bcc a second time', async () => {
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
      assert.equal(postInbox[`test${i}`], 1, `did not delivery directly to test${i}`)
    }
  })
  it('retries delivery to a flaky recipient', async () => {
    const activity = await as2.import({
      id: 'https://activitypubbot.example/user/test0/intransitiveactivity/15',
      type: 'IntransitiveActivity',
      actor: 'https://activitypubbot.example/user/test0',
      to: ['https://flaky.example/user/test1']
    })
    try {
      await distributor.distribute(activity, 'test0')
    } catch (error) {
      assert.fail(`Error in distribution: ${error.message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
    assert.equal(postSharedInbox['flaky.example'], 1)
  })
  it('can deliver a single activity to a local account', async () => {
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
  it('will not deliver an activity to the actor', async () => {
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
})
