import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { nanoid } from 'nanoid'
import Logger from 'pino'
import { nockSetup, nockFormat, addFollower, addFollowing, addToCollection, makeActor } from '@evanp/activitypub-nock'

import { Authorizer } from '../lib/authorizer.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { KeyStorage } from '../lib/keystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import as2 from '../lib/activitystreams.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'
import { RateLimiter } from '../lib/ratelimiter.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'

import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

describe('Authorizer', () => {
  const LOCAL_HOST = 'local.authorizer.test'
  const LOCAL_ORIGIN = `https://${LOCAL_HOST}`
  const REMOTE_HOST = 'remote.authorizer.test'
  const REMOTE_ORIGIN = `https://${REMOTE_HOST}`
  const THIRD_HOST = 'third.authorizer.test'
  const LOCAL_USER_1 = 'authorizertest1'
  const LOCAL_USER_2 = 'authorizertest2'
  const LOCAL_USER_3 = 'authorizertest3'
  const LOCAL_USER_4 = 'authorizertest4'
  const LOCAL_USER_5 = 'authorizertest5'
  const LOCAL_USER_6 = 'authorizertest6'
  const LOCAL_USER_7 = 'authorizertest7'
  const LOCAL_USER_8 = 'authorizertest8'
  const LOCAL_USER_9 = 'authorizertest9'
  const LOCAL_USER_10 = 'authorizertest10'
  const LOCAL_USER_11 = 'authorizertest11'
  const LOCAL_USER_12 = 'authorizertest12'
  const LOCAL_USER_13 = 'authorizertest13'
  const LOCAL_USER_14 = 'authorizertest14'
  const LOCAL_USER_15 = 'authorizertest15'

  const REMOTE_USER_1 = 'authorizerremote1'
  const REMOTE_USER_2 = 'authorizerremote2'
  const REMOTE_USER_3 = 'authorizerremote3'
  const REMOTE_USER_4 = 'authorizerremote4'
  const REMOTE_USER_6 = 'authorizerremote6'
  const REMOTE_USER_7 = 'authorizerremote7'
  const REMOTE_USER_8 = 'authorizerremote8'
  const REMOTE_USER_9 = 'authorizerremote9'
  const REMOTE_USER_10 = 'authorizerremote10'
  const REMOTE_USER_11 = 'authorizerremote11'

  const THIRD_USER_1 = 'authorizerthird1'
  const THIRD_USER_2 = 'authorizerthird2'
  const THIRD_USER_3 = 'authorizerthird3'

  const TEST_USERNAMES = [LOCAL_USER_1, LOCAL_USER_2, LOCAL_USER_3, LOCAL_USER_4, LOCAL_USER_5, LOCAL_USER_6, LOCAL_USER_7, LOCAL_USER_8, LOCAL_USER_9, LOCAL_USER_10, LOCAL_USER_11, LOCAL_USER_12, LOCAL_USER_13, LOCAL_USER_14, LOCAL_USER_15]

  let authorizer = null
  let actorStorage = null
  let formatter = null
  let connection = null
  let keyStorage = null
  let client = null

  let actor1 = null
  let actor2 = null
  let actor3 = null
  let publicObject = null
  let followersOnlyObject = null
  let privateObject = null
  let remoteUnconnected = null
  let remoteFollower = null
  let remoteAddressee = null
  let remotePublicObject = null
  let remotePrivateObject = null

  before(async () => {
    const logger = Logger({
      level: 'silent'
    })
    formatter = new UrlFormatter(LOCAL_ORIGIN)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    actorStorage = new ActorStorage(connection, formatter)
    keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    const limiter = new RateLimiter(connection, logger)
    const remoteObjectCache = new RemoteObjectCache(connection, logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, limiter, remoteObjectCache)
    nockSetup(REMOTE_HOST)
    nockSetup(THIRD_HOST)
    actor1 = await actorStorage.getActor(LOCAL_USER_1)
    actor2 = await actorStorage.getActor(LOCAL_USER_2)
    await actorStorage.addToCollection(
      LOCAL_USER_1,
      'followers',
      actor2
    )
    actor3 = await actorStorage.getActor(LOCAL_USER_3)
    remoteUnconnected = await as2.import({
      id: `${REMOTE_ORIGIN}/user/${REMOTE_USER_1}`,
      type: 'Person',
      preferredUsername: REMOTE_USER_1,
      to: 'as:Public'
    })
    remoteFollower = await as2.import({
      id: `${REMOTE_ORIGIN}/user/${REMOTE_USER_2}`,
      type: 'Person',
      preferredUsername: REMOTE_USER_2,
      to: 'as:Public'
    })
    await actorStorage.addToCollection(
      LOCAL_USER_1,
      'followers',
      remoteFollower
    )
    remoteAddressee = await as2.import({
      id: `${REMOTE_ORIGIN}/user/${REMOTE_USER_3}`,
      type: 'Person',
      preferredUsername: REMOTE_USER_3,
      to: 'as:Public'
    })
    publicObject = await as2.import({
      id: formatter.format({
        username: LOCAL_USER_1,
        type: 'object',
        nanoid: nanoid()
      }),
      type: 'Object',
      attributedTo: actor1.id,
      to: 'as:Public'
    })
    followersOnlyObject = await as2.import({
      id: formatter.format({
        username: LOCAL_USER_1,
        type: 'object',
        nanoid: nanoid()
      }),
      type: 'Object',
      attributedTo: actor1.id,
      to: formatter.format({
        username: LOCAL_USER_1,
        collection: 'followers'
      })
    })
    privateObject = await as2.import({
      id: formatter.format({
        username: LOCAL_USER_1,
        type: 'object',
        nanoid: nanoid()
      }),
      type: 'Object',
      attributedTo: actor1.id,
      to: [actor2.id, remoteAddressee.id]
    })
    remotePublicObject = await as2.import({
      id: `${REMOTE_ORIGIN}/user/${REMOTE_USER_1}/object/1`,
      type: 'Object',
      attributedTo: remoteUnconnected.id,
      to: 'as:Public'
    })
    remotePrivateObject = await as2.import({
      id: `${REMOTE_ORIGIN}/user/${REMOTE_USER_1}/object/2`,
      type: 'Object',
      attributedTo: remoteUnconnected.id,
      to: actor2.id
    })
  })

  after(async () => {
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    await connection.close()
    formatter = null
    actorStorage = null
    connection = null
    authorizer = null
  })

  it('should be a class', async () => {
    assert.strictEqual(typeof Authorizer, 'function')
  })

  it('can be instantiated', async () => {
    try {
      authorizer = new Authorizer(actorStorage, formatter, client)
      assert.strictEqual(typeof authorizer, 'object')
    } catch (error) {
      assert.fail(error)
    }
  })

  it('can check the creator can read a public local object', async () => {
    assert.strictEqual(true, await authorizer.canRead(actor1, publicObject))
  })

  it('can check the creator can read a followers-only local object', async () => {
    assert.strictEqual(
      true,
      await authorizer.canRead(actor1, followersOnlyObject)
    )
  })

  it('can check the creator can read a private local object', async () => {
    assert.strictEqual(
      true,
      await authorizer.canRead(actor1, privateObject)
    )
  })

  it('can check if a local follower can read a public local object', async () => {
    assert.strictEqual(true, await authorizer.canRead(actor2, publicObject))
  })

  it('can check if a local follower can read a followers-only local object', async () => {
    assert.strictEqual(true, await authorizer.canRead(actor2, followersOnlyObject))
  })

  it('can check if a local addressee can read a private local object', async () => {
    assert.strictEqual(true, await authorizer.canRead(actor2, privateObject))
  })

  it('can check if a local non-follower can read a public local object', async () => {
    assert.strictEqual(true, await authorizer.canRead(actor3, publicObject))
  })

  it('can check if a local non-follower can read a followers-only local object', async () => {
    assert.strictEqual(false, await authorizer.canRead(actor3, followersOnlyObject))
  })

  it('can check if a local non-addressee can read a private local object', async () => {
    assert.strictEqual(false, await authorizer.canRead(actor3, privateObject))
  })

  it('can check if the null actor can read a public local object', async () => {
    assert.strictEqual(true, await authorizer.canRead(null, publicObject))
  })

  it('can check if the null actor can read a followers-only local object', async () => {
    assert.strictEqual(false, await authorizer.canRead(null, followersOnlyObject))
  })

  it('can check if the null actor can read a private local object', async () => {
    assert.strictEqual(false, await authorizer.canRead(null, privateObject))
  })

  it('can check that an unconnected remote actor can read a public local object', async () => {
    assert.strictEqual(true, await authorizer.canRead(remoteUnconnected, publicObject))
  })

  it('can check that an unconnected remote actor cannot read a followers-only local object', async () => {
    assert.strictEqual(
      false,
      await authorizer.canRead(remoteUnconnected, followersOnlyObject)
    )
  })

  it('can check that an unconnected remote actor cannot read a private local object', async () => {
    assert.strictEqual(
      false,
      await authorizer.canRead(remoteUnconnected, privateObject)
    )
  })

  it('can check that a remote follower can read a public local object', async () => {
    assert.strictEqual(true, await authorizer.canRead(remoteFollower, publicObject))
  })

  it('can check that a remote follower can read a followers-only local object', async () => {
    assert.strictEqual(
      true,
      await authorizer.canRead(remoteFollower, followersOnlyObject)
    )
  })

  it('can check that a remote follower cannot read a private local object', async () => {
    assert.strictEqual(
      false,
      await authorizer.canRead(remoteFollower, privateObject)
    )
  })

  it('can check that a remote addressee can read a private local object', async () => {
    assert.strictEqual(true, await authorizer.canRead(remoteAddressee, privateObject))
  })

  it('can check that a local actor can read a public remote object', async () => {
    assert.strictEqual(true, await authorizer.canRead(actor1, remotePublicObject))
  })

  it('can check that a local non-addressee cannot read a private remote object', async () => {
    assert.strictEqual(null, await authorizer.canRead(actor1, remotePrivateObject))
  })

  it('can check that a local addressee can read a private remote object', async () => {
    assert.strictEqual(true, await authorizer.canRead(actor2, remotePrivateObject))
  })

  it('can check that two objects have the same origin', async () => {
    const object1 = await as2.import({
      id: 'https://example.com/object/1',
      type: 'Object'
    })
    const object2 = await as2.import({
      id: 'https://example.com/object/2',
      type: 'Object'
    })
    assert.strictEqual(true, await authorizer.sameOrigin(object1, object2))
  })

  it('can check that two objects have different origins', async () => {
    const object1 = await as2.import({
      id: 'https://example.com/object/1',
      type: 'Object'
    })
    const object2 = await as2.import({
      id: 'https://other.authorizer.test/object/2',
      type: 'Object'
    })
    assert.strictEqual(false, await authorizer.sameOrigin(object1, object2))
  })

  it('can check that two objects have different origins by port', async () => {
    const object1 = await as2.import({
      id: 'https://example.com/object/1',
      type: 'Object'
    })
    const object2 = await as2.import({
      id: 'https://example.com:8000/object/2',
      type: 'Object'
    })
    assert.strictEqual(false, await authorizer.sameOrigin(object1, object2))
  })

  it('can check that two objects have different origins by protocol', async () => {
    const object1 = await as2.import({
      id: 'https://example.com/object/1',
      type: 'Object'
    })
    const object2 = await as2.import({
      id: 'http://example.com/object/2',
      type: 'Object'
    })
    assert.strictEqual(false, await authorizer.sameOrigin(object1, object2))
  })

  it('can authorize a local member of a remote followers collection', async () => {
    const actor = await actorStorage.getActor(LOCAL_USER_4)
    addFollower(REMOTE_USER_4, actor.id, REMOTE_HOST)
    await actorStorage.addToCollection(
      LOCAL_USER_4,
      'following',
      await makeActor(REMOTE_USER_4, REMOTE_HOST))
    const obj = await as2.import({
      id: formatter.format({ username: LOCAL_USER_5, type: 'object', nanoid: '55UW4OscbRfr0tXpbES49' }),
      attributedTo: formatter.format({ username: LOCAL_USER_5 }),
      to: nockFormat({ username: REMOTE_USER_4, collection: 'followers', domain: REMOTE_HOST }),
      type: 'Object'
    })
    assert.strictEqual(true, await authorizer.canRead(actor, obj))
  })

  it('can authorize a local member of a remote following collection', async () => {
    const actor = await actorStorage.getActor(LOCAL_USER_6)
    addFollowing(REMOTE_USER_6, actor.id, REMOTE_HOST)
    await actorStorage.addToCollection(
      LOCAL_USER_6,
      'followers',
      await makeActor(REMOTE_USER_6, REMOTE_HOST)
    )
    const obj = await as2.import({
      id: formatter.format({ username: LOCAL_USER_7, type: 'object', nanoid: 'S1s-po_XzeIsjuXGp7UQV' }),
      attributedTo: formatter.format({ username: LOCAL_USER_7 }),
      to: nockFormat({ username: REMOTE_USER_6, collection: 'following', domain: REMOTE_HOST }),
      type: 'Object'
    })
    assert.strictEqual(true, await authorizer.canRead(actor, obj))
  })

  it('can authorize a local member of a local following collection', async () => {
    const actor1 = await actorStorage.getActor(LOCAL_USER_8)
    const actor2 = await actorStorage.getActor(LOCAL_USER_9)

    await actorStorage.addToCollection(
      LOCAL_USER_8,
      'followers',
      actor2
    )

    await actorStorage.addToCollection(
      LOCAL_USER_9,
      'following',
      actor1
    )

    const obj = await as2.import({
      id: formatter.format({ username: LOCAL_USER_9, type: 'object', nanoid: 'VralZ6EJrn4ROoDNGIfqH' }),
      attributedTo: actor2.id,
      to: formatter.format({ username: LOCAL_USER_9, collection: 'following' }),
      type: 'Object'
    })
    assert.strictEqual(true, await authorizer.canRead(actor1, obj))
  })

  it('can authorize a remote member of a local following collection', async () => {
    const actor1 = await actorStorage.getActor(LOCAL_USER_10)
    const actor2 = await makeActor(REMOTE_USER_7, REMOTE_HOST)

    addFollower(REMOTE_USER_7, actor1.id, REMOTE_HOST)

    await actorStorage.addToCollection(
      LOCAL_USER_10,
      'following',
      actor2
    )

    const obj = await as2.import({
      id: formatter.format({ username: LOCAL_USER_10, type: 'object', nanoid: '_ka_vxuI5tZDvXZnAFXYK' }),
      attributedTo: actor1.id,
      to: formatter.format({ username: LOCAL_USER_10, collection: 'following' }),
      type: 'Object'
    })
    assert.strictEqual(true, await authorizer.canRead(actor2, obj))
  })

  it('can authorize a remote member of a remote following collection', async () => {
    const actor1 = await makeActor(REMOTE_USER_8, REMOTE_HOST)
    const actor2 = await makeActor(THIRD_USER_1, THIRD_HOST)
    const actor3 = await actorStorage.getActor(LOCAL_USER_11)

    addFollower(REMOTE_USER_8, actor2.id, REMOTE_HOST)
    addFollowing(THIRD_USER_1, actor1.id, THIRD_HOST)

    const obj = await as2.import({
      id: formatter.format({ username: LOCAL_USER_11, type: 'object', nanoid: 'yjT5rJ9a-pTsq3H5PSvJn' }),
      attributedTo: actor3.id,
      type: 'Object',
      to: actor2.following.first.id
    })

    assert.strictEqual(true, await authorizer.canRead(actor1, obj))
  })

  it('can authorize a remote member of a remote followers collection', async () => {
    const actor1 = await makeActor(REMOTE_USER_9, REMOTE_HOST)
    const actor2 = await makeActor(THIRD_USER_2, THIRD_HOST)
    const actor3 = await actorStorage.getActor(LOCAL_USER_12)

    addFollowing(REMOTE_USER_9, actor2.id, REMOTE_HOST)
    addFollower(THIRD_USER_2, actor1.id, THIRD_HOST)

    const obj = await as2.import({
      id: formatter.format({ username: LOCAL_USER_12, type: 'object', nanoid: 'l9yNfZ8Yd6KVMs5qzIIem' }),
      attributedTo: actor3.id,
      type: 'Object',
      to: actor2.followers.first.id
    })

    assert.strictEqual(true, await authorizer.canRead(actor1, obj))
  })

  it('can authorize a local member of a remote generic collection', async () => {
    const actor2 = await actorStorage.getActor(LOCAL_USER_13)
    const actor3 = await actorStorage.getActor(LOCAL_USER_14)

    const collection = 24435
    const collectionId = nockFormat({
      username: REMOTE_USER_10,
      type: 'collection',
      num: collection,
      domain: REMOTE_HOST
    })

    addToCollection(REMOTE_USER_10, collection, actor2.id, REMOTE_HOST)

    const obj = await as2.import({
      id: formatter.format({ username: LOCAL_USER_14, type: 'object', nanoid: 'k-GTPhF_jmjN0sD-wIddB' }),
      attributedTo: actor3.id,
      type: 'Object',
      to: collectionId
    })

    assert.strictEqual(true, await authorizer.canRead(actor2, obj))
  })

  it('can authorize a remote member of a remote generic collection', async () => {
    const actor2 = await makeActor(THIRD_USER_3, THIRD_HOST)
    const actor3 = await actorStorage.getActor(LOCAL_USER_15)

    const collection = 8344
    const collectionId = nockFormat({
      username: REMOTE_USER_11,
      type: 'collection',
      num: collection,
      domain: REMOTE_HOST
    })

    addToCollection(REMOTE_USER_11, collection, actor2.id, REMOTE_HOST)

    const obj = await as2.import({
      id: formatter.format({ username: LOCAL_USER_15, type: 'object', nanoid: 'ydSxp1N_5-Iu4fnN07EXg' }),
      attributedTo: actor3.id,
      type: 'Object',
      to: collectionId
    })

    assert.strictEqual(true, await authorizer.canRead(actor2, obj))
  })
})
