import { describe, it, before, after, beforeEach } from 'node:test'
import { ActorStorage } from '../lib/actorstorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import as2 from '../lib/activitystreams.js'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'
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
  resetSharedInbox,
  addFollower,
  addFollowing
} from '@evanp/activitypub-nock'
import { KeyStorage } from '../lib/keystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import assert from 'node:assert'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import Logger from 'pino'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'

const LOCAL_HOST = 'local.activitydistributor.test'
const ORIGIN = `https://${LOCAL_HOST}`
const SOCIAL_HOST = 'social.activitydistributor.test'
const OTHER_HOST = 'other.activitydistributor.test'
const THIRD_HOST = 'third.activitydistributor.test'
const SHARED_HOST = 'shared.activitydistributor.test'
const FLAKY_HOST = 'flaky.activitydistributor.test'
const LOCAL_USER0 = 'activitydistributortest0'
const LOCAL_USER1 = 'activitydistributortest1'
const LOCAL_USER2 = 'activitydistributortest2'
const LOCAL_USER3 = 'activitydistributortest3'
const LOCAL_USER4 = 'activitydistributortest4'
const LOCAL_USER5 = 'activitydistributortest5'
const LOCAL_USER6 = 'activitydistributortest6'
const LOCAL_USER7 = 'activitydistributortest7'
const REMOTE_USER1 = 'activitydistributorremote1'
const REMOTE_USER2 = 'activitydistributorremote2'
const REMOTE_USER3 = 'activitydistributorremote3'
const REMOTE_USER4 = 'activitydistributorremote4'
const REMOTE_USER5 = 'activitydistributorremote5'
const REMOTE_USER6 = 'activitydistributorremote6'
const REMOTE_USER7 = 'activitydistributorremote7'
const FLAKY_USER = 'activitydistributorflaky1'
const SHARED_USER_PREFIX = 'activitydistributorsharedtest'
const LOCAL_USERNAMES = [
  LOCAL_USER0,
  LOCAL_USER1,
  LOCAL_USER2,
  LOCAL_USER3,
  LOCAL_USER4,
  LOCAL_USER5,
  LOCAL_USER6,
  LOCAL_USER7
]
const SIGNATURE_RE = new RegExp(
  `^keyId="https://${LOCAL_HOST.replace(/\./g, '\\.')}/user/${LOCAL_USER0}/publickey",headers="\\(request-target\\) host date user-agent content-type digest",signature=".*",algorithm="rsa-sha256"$`
)

describe('ActivityDistributor', () => {
  let connection = null
  let actorStorage = null
  let keyStorage = null
  let formatter = null
  let client = null
  let distributor = null
  let logger = null

  async function cleanup () {
    await cleanupTestData(connection, {
      usernames: LOCAL_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [SOCIAL_HOST, OTHER_HOST, THIRD_HOST, SHARED_HOST, FLAKY_HOST]
    })
  }

  before(async () => {
    logger = Logger({ level: 'silent' })
    formatter = new UrlFormatter(ORIGIN)
    connection = await createMigratedTestConnection()
    await cleanup()
    actorStorage = new ActorStorage(connection, formatter)
    keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    const actor2 = await as2.import({
      id: nockFormat({ domain: SOCIAL_HOST, username: LOCAL_USER1 })
    })
    const actor3 = await as2.import({
      id: nockFormat({ domain: OTHER_HOST, username: LOCAL_USER2 })
    })
    const actor4 = await as2.import({
      id: nockFormat({ domain: SOCIAL_HOST, username: LOCAL_USER4 })
    })
    const actor5 = await as2.import({
      id: nockFormat({ domain: OTHER_HOST, username: LOCAL_USER5 })
    })
    await actorStorage.addToCollection(LOCAL_USER0, 'followers', actor2)
    await actorStorage.addToCollection(LOCAL_USER0, 'followers', actor3)
    await actorStorage.addToCollection(LOCAL_USER0, 'following', actor4)
    await actorStorage.addToCollection(LOCAL_USER0, 'following', actor5)
    nockSetup(SOCIAL_HOST)
    nockSetup(OTHER_HOST)
    nockSetup(THIRD_HOST)
    nockSetup(SHARED_HOST, { sharedInbox: true })
    nockSetup(FLAKY_HOST, { flaky: true })
    addFollower(REMOTE_USER1, nockFormat({ domain: SOCIAL_HOST, username: REMOTE_USER2 }), SOCIAL_HOST)
    addFollower(REMOTE_USER1, nockFormat({ domain: SOCIAL_HOST, username: REMOTE_USER3 }), SOCIAL_HOST)
    addFollower(REMOTE_USER1, nockFormat({ domain: SOCIAL_HOST, username: REMOTE_USER4 }), SOCIAL_HOST)
    addFollower(REMOTE_USER1, formatter.format({ username: LOCAL_USER6 }), SOCIAL_HOST)

    addFollowing(REMOTE_USER2, nockFormat({ domain: SOCIAL_HOST, username: REMOTE_USER5 }), SOCIAL_HOST)
    addFollowing(REMOTE_USER2, nockFormat({ domain: SOCIAL_HOST, username: REMOTE_USER6 }), SOCIAL_HOST)
    addFollowing(REMOTE_USER2, nockFormat({ domain: SOCIAL_HOST, username: REMOTE_USER7 }), SOCIAL_HOST)
    addFollowing(REMOTE_USER2, formatter.format({ username: LOCAL_USER7 }), SOCIAL_HOST)
  })
  after(async () => {
    await cleanup()
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
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/1',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      to: ['https://social.activitydistributor.test/user/activitydistributortest1']
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.equal(postInbox.activitydistributortest1, 1)
    assert.ok(!postInbox.activitydistributortest2)
    const { signature, digest, date } =
      getRequestHeaders('https://social.activitydistributor.test/user/activitydistributortest1/inbox')
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, SIGNATURE_RE)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
  })
  it('can distribute an activity to all followers', async () => {
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/2',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      to: ['https://local.activitydistributor.test/user/activitydistributortest0/followers']
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    const { signature, digest, date } =
      getRequestHeaders('https://social.activitydistributor.test/user/activitydistributortest1/inbox')
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, SIGNATURE_RE)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
  })
  it('can distribute an activity to the public', async () => {
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/3',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      to: ['https://www.w3.org/ns/activitystreams#Public']
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(!postInbox.activitydistributortest1)
    assert.ok(!postInbox.activitydistributortest2)
  })
  it('can distribute an activity to an addressed actor and followers', async () => {
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/4',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      to: ['https://social.activitydistributor.test/user/activitydistributortest1'],
      cc: ['https://local.activitydistributor.test/user/activitydistributortest0/followers']
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(postInbox.activitydistributortest1)
    assert.ok(postInbox.activitydistributortest2)
    const { signature, digest, date } =
      getRequestHeaders('https://social.activitydistributor.test/user/activitydistributortest1/inbox')
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, SIGNATURE_RE)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
  })
  it('can distribute an activity to an addressed actor and the public', async () => {
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/5',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      to: ['https://social.activitydistributor.test/user/activitydistributortest1'],
      cc: ['https://www.w3.org/ns/activitystreams#Public']
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(postInbox.activitydistributortest1)
    assert.ok(!postInbox.activitydistributortest2)
    const { signature, digest, date } =
      getRequestHeaders('https://social.activitydistributor.test/user/activitydistributortest1/inbox')
    assert.ok(signature)
    assert.ok(digest)
    assert.ok(date)
    assert.match(signature, SIGNATURE_RE)
    assert.match(digest, /^sha-256=[0-9a-zA-Z=+/]*$/)
    assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
  })
  it('only sends once to an addressed follower', async () => {
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/6',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      to: ['https://other.activitydistributor.test/user/activitydistributortest2'],
      cc: ['https://local.activitydistributor.test/user/activitydistributortest0/followers']
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.equal(postInbox.activitydistributortest2, 1)
  })
  it('does not send bcc or bto over the wire', async () => {
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/8',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      bto: ['https://other.activitydistributor.test/user/activitydistributortest2'],
      bcc: ['https://third.activitydistributor.test/user/activitydistributortest3']
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.equal(postInbox.activitydistributortest2, 1)
    assert.equal(postInbox.activitydistributortest3, 1)
    const body = getBody('https://other.activitydistributor.test/user/activitydistributortest2/inbox')
    assert.ok(!body.match(/bcc/))
    assert.ok(!body.match(/bto/))
  })
  it('posts once to a shared inbox', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1)
    const remotes = nums.map(n => `https://${SHARED_HOST}/user/${SHARED_USER_PREFIX}${n}`)
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/9',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      to: remotes
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.equal(postSharedInbox[SHARED_HOST], 1)
    for (const i of nums) {
      assert.ok(!postInbox[`${SHARED_USER_PREFIX}${i}`])
    }
  })
  it('uses the cache for sending again to same actors', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1)
    const remotes = nums.map(n => `https://${SHARED_HOST}/user/${SHARED_USER_PREFIX}${n}`)
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/10',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      to: remotes
    })
    assert.equal(postSharedInbox[SHARED_HOST], 0)
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.equal(postSharedInbox[SHARED_HOST], 1)
  })
  it('distributes directly for addressees in bto', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1)
    const remotes = nums.map(n => `https://${SHARED_HOST}/user/${SHARED_USER_PREFIX}${n}`)
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/11',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      bto: remotes
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(!postSharedInbox[SHARED_HOST])
    for (const i of nums) {
      assert.equal(postInbox[`${SHARED_USER_PREFIX}${i}`], 1, `did not distribute directly to ${SHARED_USER_PREFIX}${i}`)
    }
  })
  it('distributes directly for addressees in bto a second time', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1)
    const remotes = nums.map(n => `https://${SHARED_HOST}/user/${SHARED_USER_PREFIX}${n}`)
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/12',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      bto: remotes
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(!postSharedInbox[SHARED_HOST])
    for (const i of nums) {
      assert.equal(postInbox[`${SHARED_USER_PREFIX}${i}`], 1, `did not distribute directly to ${SHARED_USER_PREFIX}${i}`)
    }
  })
  it('distributes directly for addressees in bcc', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1).map(n => n + 100)
    const remotes = nums.map(n => `https://${SHARED_HOST}/user/${SHARED_USER_PREFIX}${n}`)
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/13',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      bcc: remotes
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(!postSharedInbox[SHARED_HOST])
    for (const i of nums) {
      assert.equal(postInbox[`${SHARED_USER_PREFIX}${i}`], 1, `did not distribute directly to ${SHARED_USER_PREFIX}${i}`)
    }
  })
  it('distributes directly for addressees in bcc a second time', async () => {
    const nums = Array.from({ length: 10 }, (v, k) => k + 1).map(n => n + 100)
    const remotes = nums.map(n => `https://${SHARED_HOST}/user/${SHARED_USER_PREFIX}${n}`)
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/14',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      bcc: remotes
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(!postSharedInbox[SHARED_HOST])
    for (const i of nums) {
      assert.equal(postInbox[`${SHARED_USER_PREFIX}${i}`], 1, `did not distribute directly to ${SHARED_USER_PREFIX}${i}`)
    }
  })
  it('retries distribution to a flaky recipient', async () => {
    const activity = await as2.import({
      id: 'https://local.activitydistributor.test/user/activitydistributortest0/intransitiveactivity/15',
      type: 'IntransitiveActivity',
      actor: 'https://local.activitydistributor.test/user/activitydistributortest0',
      to: ['https://flaky.activitydistributor.test/user/activitydistributorflaky1']
    })
    try {
      await distributor.distribute(activity, 'activitydistributortest0')
    } catch (error) {
      assert.fail(`Error in distribution: ${error.message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
    assert.equal(postInbox.activitydistributorflaky1, 1)
  })
  it('can distribute a single activity to a local account', async () => {
    const id = formatter.format({
      username: 'activitydistributortest0',
      type: 'intransitiveactivity',
      nanoid: 'Ca45kO_L7haXDXWdqoWHE'
    })
    const activity = await as2.import({
      id,
      type: 'IntransitiveActivity',
      actor: formatter.format({ username: 'activitydistributortest0' }),
      to: formatter.format({ username: 'activitydistributortest1' })
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(await actorStorage.isInCollection(
      'activitydistributortest1',
      'inbox',
      activity
    ))
  })
  it('will not distribute an activity to the actor', async () => {
    const id = formatter.format({
      username: 'activitydistributortest0',
      type: 'intransitiveactivity',
      nanoid: 'ubiKNmJow3A_D52IZOsRL'
    })
    const activity = await as2.import({
      id,
      type: 'IntransitiveActivity',
      actor: formatter.format({ username: 'activitydistributortest0' }),
      to: formatter.format({ username: 'activitydistributortest0' })
    })
    // Add to inbox and outbox to simulate real activity generation
    await actorStorage.addToCollection('activitydistributortest0', 'inbox', activity)
    await actorStorage.addToCollection('activitydistributortest0', 'outbox', activity)
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(await actorStorage.isInCollection(
      'activitydistributortest0',
      'inbox',
      activity
    ))
  })
  it('can distribute an activity to local following collection', async () => {
    const id = formatter.format({
      username: 'activitydistributortest0',
      type: 'intransitiveactivity',
      nanoid: '32GwjbnzIo6dzoicvlETu'
    })
    const activity = await as2.import({
      id,
      type: 'IntransitiveActivity',
      actor: formatter.format({ username: 'activitydistributortest0' }),
      to: formatter.format({ username: 'activitydistributortest0', collection: 'following' })
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(postInbox.activitydistributortest4)
    assert.ok(postInbox.activitydistributortest5)
  })
  it('can distribute an activity to remote followers collection', async () => {
    const id = formatter.format({
      username: 'activitydistributortest0',
      type: 'intransitiveactivity',
      nanoid: 'Lh-2nLaiVCXQDFisyg8FR'
    })
    const activity = await as2.import({
      id,
      type: 'IntransitiveActivity',
      actor: formatter.format({ username: 'activitydistributortest0' }),
      to: nockFormat({ domain: SOCIAL_HOST, username: REMOTE_USER1, collection: 'followers' })
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(postInbox.activitydistributorremote2)
    assert.ok(postInbox.activitydistributorremote3)
    assert.ok(postInbox.activitydistributorremote4)
    assert.ok(await actorStorage.isInCollection('activitydistributortest6', 'inbox', activity))
  })
  it('can distribute an activity to remote following collection', async () => {
    const id = formatter.format({
      username: 'activitydistributortest0',
      type: 'intransitiveactivity',
      nanoid: '32GwjbnzIo6dzoicvlETu'
    })
    const activity = await as2.import({
      id,
      type: 'IntransitiveActivity',
      actor: formatter.format({ username: 'activitydistributortest0' }),
      to: nockFormat({ domain: SOCIAL_HOST, username: REMOTE_USER2, collection: 'following' })
    })
    await distributor.distribute(activity, 'activitydistributortest0')
    await distributor.onIdle()
    assert.ok(postInbox.activitydistributorremote5)
    assert.ok(postInbox.activitydistributorremote6)
    assert.ok(postInbox.activitydistributorremote7)
    assert.ok(await actorStorage.isInCollection('activitydistributortest7', 'inbox', activity))
  })
})
