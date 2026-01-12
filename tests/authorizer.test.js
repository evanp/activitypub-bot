import { describe, it, before, after } from 'node:test'
import { Authorizer } from '../lib/authorizer.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { Sequelize } from 'sequelize'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ObjectStorage } from '../lib/objectstorage.js'
import { KeyStorage } from '../lib/keystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import as2 from '../lib/activitystreams.js'
import assert from 'node:assert/strict'
import { nanoid } from 'nanoid'
import { HTTPSignature } from '../lib/httpsignature.js'
import Logger from 'pino'
import { Digester } from '../lib/digester.js'
import { runMigrations } from '../lib/migrations/index.js'

describe('Authorizer', () => {
  let authorizer = null
  let actorStorage = null
  let formatter = null
  let connection = null
  let objectStorage = null
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
    formatter = new UrlFormatter('https://activitypubbot.example')
    connection = new Sequelize('sqlite::memory:', { logging: false })
    await connection.authenticate()
    await runMigrations(connection)
    actorStorage = new ActorStorage(connection, formatter)
    objectStorage = new ObjectStorage(connection)
    keyStorage = new KeyStorage(connection, logger)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    actor1 = await actorStorage.getActor('test1')
    actor2 = await actorStorage.getActor('test2')
    await actorStorage.addToCollection(
      'test1',
      'followers',
      actor2
    )
    actor3 = await actorStorage.getActor('test3')
    remoteUnconnected = await as2.import({
      id: 'https://remote.example/user/remote1',
      type: 'Person',
      preferredUsername: 'remote1',
      to: 'as:Public'
    })
    remoteFollower = await as2.import({
      id: 'https://remote.example/user/remote2',
      type: 'Person',
      preferredUsername: 'remote2',
      to: 'as:Public'
    })
    await actorStorage.addToCollection(
      'test1',
      'followers',
      remoteFollower
    )
    remoteAddressee = await as2.import({
      id: 'https://remote.example/user/remote3',
      type: 'Person',
      preferredUsername: 'remote3',
      to: 'as:Public'
    })
    publicObject = await as2.import({
      id: formatter.format({
        username: 'test1',
        type: 'object',
        nanoid: nanoid()
      }),
      type: 'Object',
      attributedTo: actor1.id,
      to: 'as:Public'
    })
    followersOnlyObject = await as2.import({
      id: formatter.format({
        username: 'test1',
        type: 'object',
        nanoid: nanoid()
      }),
      type: 'Object',
      attributedTo: actor1.id,
      to: formatter.format({
        username: 'test1',
        collection: 'followers'
      })
    })
    privateObject = await as2.import({
      id: formatter.format({
        username: 'test1',
        type: 'object',
        nanoid: nanoid()
      }),
      type: 'Object',
      attributedTo: actor1.id,
      to: [actor2.id, remoteAddressee.id]
    })
    remotePublicObject = await as2.import({
      id: 'https://remote.example/user/remote1/object/1',
      type: 'Object',
      attributedTo: remoteUnconnected.id,
      to: 'as:Public'
    })
    remotePrivateObject = await as2.import({
      id: 'https://remote.example/user/remote1/object/2',
      type: 'Object',
      attributedTo: remoteUnconnected.id,
      to: actor2.id
    })
  })

  after(async () => {
    await connection.close()
    formatter = null
    actorStorage = null
    connection = null
    authorizer = null
    objectStorage = null
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
      id: 'https://other.example/object/2',
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
})
