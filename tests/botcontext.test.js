import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { BotContext } from '../lib/botcontext.js'
import { Sequelize } from 'sequelize'
import { BotDataStorage } from '../lib/botdatastorage.js'
import { ObjectStorage } from '../lib/objectstorage.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { Transformer } from '../lib/microsyntax.js'
import {
  nockSetup,
  postInbox,
  resetInbox,
  makeActor,
  makeObject
} from './utils/nock.js'
import Logger from 'pino'
import as2 from 'activitystrea.ms'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'

const AS2_NS = 'https://www.w3.org/ns/activitystreams#'

describe('BotContext', () => {
  let connection = null
  let botDataStorage = null
  let objectStorage = null
  let keyStorage = null
  let actorStorage = null
  let formatter = null
  let client = null
  let distributor = null
  let context = null
  let actor3 = null
  let actor5 = null
  let actor6 = null
  let note = null
  let transformer = null
  let logger = null
  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    formatter = new UrlFormatter('https://activitypubbot.example')
    connection = new Sequelize('sqlite::memory:', { logging: false })
    await connection.authenticate()
    botDataStorage = new BotDataStorage(connection)
    await botDataStorage.initialize()
    objectStorage = new ObjectStorage(connection)
    await objectStorage.initialize()
    keyStorage = new KeyStorage(connection)
    await keyStorage.initialize()
    actorStorage = new ActorStorage(connection, formatter)
    await actorStorage.initialize()
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    distributor = new ActivityDistributor(client, formatter, actorStorage, logger)
    transformer = new Transformer('https://activitypubbot.example/tag/', client)
    await objectStorage.create(
      await as2.import({
        id: formatter.format({
          username: 'test1',
          type: 'object',
          nanoid: '_pEWsKke-7lACTdM3J_qd'
        }),
        type: 'Object',
        attributedTo: formatter.format({ username: 'test1' }),
        to: 'https://www.w3.org/ns/activitystreams#Public'
      })
    )
    nockSetup('social.example')
  })
  after(async () => {
    await connection.close()
    context = null
    distributor = null
    client = null
    formatter = null
    actorStorage = null
    keyStorage = null
    botDataStorage = null
    objectStorage = null
    connection = null
  })
  beforeEach(async () => {
    resetInbox()
  })
  it('can initialize', async () => {
    context = new BotContext(
      'test1',
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer
    )
  })
  it('can get the bot ID', () => {
    assert.strictEqual(context.botId, 'test1')
  })
  it('can set a value', async () => {
    await context.setData('key1', 'value1')
  })
  it('can get a value', async () => {
    const value = await context.getData('key1')
    assert.equal(value, 'value1')
  })
  it('can delete a value', async () => {
    await context.deleteData('key1')
  })
  it('can get a local object', async () => {
    const id = formatter.format({
      username: 'test1',
      type: 'object',
      nanoid: '_pEWsKke-7lACTdM3J_qd'
    })
    const object = await context.getObject(id)
    assert.ok(object)
    assert.strictEqual(object.id, id)
    assert.strictEqual(
      object.type,
      'https://www.w3.org/ns/activitystreams#Object'
    )
  })
  it('can get a remote object', async () => {
    const id = 'https://social.example/user/test2/object/1'
    const object = await context.getObject(id)
    assert.ok(object)
    assert.strictEqual(object.id, id)
    assert.strictEqual(
      object.type,
      'https://www.w3.org/ns/activitystreams#Object'
    )
  })
  it('can send a note', async () => {
    const actor2 = await makeActor('test2')
    await actorStorage.addToCollection('test1', 'followers', actor2)
    let followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 1)
    const content = 'Hello World'
    const to = 'https://www.w3.org/ns/activitystreams#Public'
    note = await context.sendNote(content, { to })
    assert.ok(note)
    assert.strictEqual(note.type, 'https://www.w3.org/ns/activitystreams#Note')
    assert.strictEqual(await note.content.get(), `<p>${content}</p>`)
    const iter = note.attributedTo[Symbol.iterator]()
    const actor = iter.next().value
    assert.strictEqual(actor.id, 'https://activitypubbot.example/user/test1')
    const iter2 = note.to[Symbol.iterator]()
    const addressee = iter2.next().value
    assert.strictEqual(addressee.id, to)
    assert.strictEqual(typeof note.published, 'object')
    assert.strictEqual(typeof note.id, 'string')
    await context.onIdle()
    assert.strictEqual(postInbox.test2, 1)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 1)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 1)
    followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can like an object', async () => {
    const id = 'https://social.example/user/test2/object/1'
    const obj = await context.getObject(id)
    await context.likeObject(obj)
    await context.onIdle()
    assert.strictEqual(postInbox.test2, 1)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 2)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 2)
    const liked = await actorStorage.getCollection('test1', 'liked')
    assert.strictEqual(liked.totalItems, 1)
  })
  it('can unlike an object', async () => {
    const id = 'https://social.example/user/test2/object/1'
    const obj = await context.getObject(id)
    await context.unlikeObject(obj)
    await context.onIdle()
    assert.strictEqual(postInbox.test2, 1)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 3)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 3)
    const liked = await actorStorage.getCollection('test1', 'liked')
    assert.strictEqual(liked.totalItems, 0)
  })
  it('can follow an actor', async () => {
    actor3 = await makeActor('test3')
    await context.followActor(actor3)
    await context.onIdle()
    assert.strictEqual(postInbox.test3, 1)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 4)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 4)
    const pendingFollowing = await actorStorage.getCollection(
      'test1',
      'pendingFollowing'
    )
    assert.strictEqual(pendingFollowing.totalItems, 1)
  })
  it('can unfollow a pending actor', async () => {
    await context.unfollowActor(actor3)
    await context.onIdle()
    assert.strictEqual(postInbox.test3, 1)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 5)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 5)
    const pendingFollowing = await actorStorage.getCollection(
      'test1',
      'pendingFollowing'
    )
    assert.strictEqual(pendingFollowing.totalItems, 0)
  })
  it('can unfollow a followed actor', async () => {
    const actor4 = await makeActor('test4')
    await actorStorage.addToCollection('test1', 'following', actor4)
    let following = await actorStorage.getCollection('test1', 'following')
    assert.strictEqual(following.totalItems, 1)
    await context.unfollowActor(actor4)
    await context.onIdle()
    assert.strictEqual(postInbox.test4, 1)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 6)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 6)
    following = await actorStorage.getCollection('test1', 'following')
    assert.strictEqual(following.totalItems, 0)
  })
  it('can block an actor without a relationship', async () => {
    let followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 1)
    actor5 = await makeActor('test5')
    await context.blockActor(actor5)
    await context.onIdle()
    assert.ok(!postInbox.test5)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 7)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 7)
    const blocked = await actorStorage.getCollection('test1', 'blocked')
    assert.strictEqual(blocked.totalItems, 1)
    followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can unblock an actor without a relationship', async () => {
    let followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 1)
    await context.unblockActor(actor5)
    await context.onIdle()
    assert.ok(!postInbox.test5)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 8)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 8)
    const blocked = await actorStorage.getCollection('test1', 'blocked')
    assert.strictEqual(blocked.totalItems, 0)
    followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can block an actor with a relationship', async () => {
    actor6 = await makeActor('test6')
    let followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 1)
    await actorStorage.addToCollection('test1', 'following', actor6)
    await actorStorage.addToCollection('test1', 'followers', actor6)
    followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 2)
    await context.blockActor(actor6)
    await context.onIdle()
    assert.ok(!postInbox.test6)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 9)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 9)
    const blocked = await actorStorage.getCollection('test1', 'blocked')
    assert.strictEqual(blocked.totalItems, 1)
    const following = await actorStorage.getCollection('test1', 'following')
    assert.strictEqual(following.totalItems, 0)
    followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can unblock an actor with a former relationship', async () => {
    await context.unblockActor(actor6)
    assert.ok(!postInbox.test6)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 10)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 10)
    const blocked = await actorStorage.getCollection('test1', 'blocked')
    assert.strictEqual(blocked.totalItems, 0)
    const following = await actorStorage.getCollection('test1', 'following')
    assert.strictEqual(following.totalItems, 0)
    const followers = await actorStorage.getCollection('test1', 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can update a note', async () => {
    const content = 'Hello World 2'
    await context.updateNote(note, content)
    await context.onIdle()
    assert.strictEqual(postInbox.test2, 1)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 11)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 11)
    const copy = await context.getObject(note.id)
    assert.strictEqual(copy.content.get(), content)
  })
  it('can delete a note', async () => {
    await context.deleteNote(note)
    await context.onIdle()
    assert.strictEqual(postInbox.test2, 1)
    const outbox = await actorStorage.getCollection('test1', 'outbox')
    assert.strictEqual(outbox.totalItems, 12)
    const inbox = await actorStorage.getCollection('test1', 'inbox')
    assert.strictEqual(inbox.totalItems, 12)
    const copy = await context.getObject(note.id)
    assert.ok(copy)
    assert.strictEqual(
      copy.type,
      'https://www.w3.org/ns/activitystreams#Tombstone'
    )
    assert.ok(copy.deleted)
    // FIXME: check for formerType when activitystrea.ms supports it
  })
  it('fails when liking an object twice', async () => {
    const id = 'https://social.example/user/test2/object/2'
    const obj = await context.getObject(id)
    await context.likeObject(obj)
    await context.onIdle()
    try {
      await context.likeObject(obj)
      assert.fail('Expected an error')
    } catch (error) {
      assert.ok(true)
    }
  })
  it('fails when unliking an object never seen before', async () => {
    const id = 'https://social.example/user/test2/object/3'
    const obj = await context.getObject(id)
    try {
      await context.unlikeObject(obj)
      assert.fail('Expected an error')
    } catch (error) {
      assert.ok(true)
    }
  })
  it('can send a reply', async () => {
    const actor3 = await makeActor('test3')
    const object = await makeObject('test7', 'Note', 1)
    const content = '@test2@social.example hello back'
    const to = [actor3.id, 'as:Public']
    const inReplyTo = object.id
    note = await context.sendNote(content, { to, inReplyTo })
    assert.ok(note)
    assert.strictEqual(note.type, 'https://www.w3.org/ns/activitystreams#Note')
    assert.strictEqual(
      await note.content.get(),
      '<p>' +
        '<a href="https://social.example/profile/test2">' +
        '@test2@social.example' +
        '</a> hello back</p>'
    )
    const iter = note.attributedTo[Symbol.iterator]()
    const actor = iter.next().value
    assert.strictEqual(actor.id, 'https://activitypubbot.example/user/test1')
    const iter2 = note.to[Symbol.iterator]()
    const addressee = iter2.next().value
    assert.strictEqual(addressee.id, actor3.id)
    assert.strictEqual(typeof note.published, 'object')
    assert.strictEqual(typeof note.id, 'string')
    const tag = note.tag.first
    assert.strictEqual(
      tag.type,
      'https://www.w3.org/ns/activitystreams#Mention'
    )
    assert.strictEqual(tag.href, 'https://social.example/profile/test2')
    await context.onIdle()
  })
  it('can send a tag', async () => {
    const content = 'Thank you Sally! #gratitude'
    const to = 'as:Public'
    note = await context.sendNote(content, { to })
    assert.ok(note)
    assert.strictEqual(
      note.content.get(),
      '<p>Thank you Sally! ' +
        '<a href="https://activitypubbot.example/tag/gratitude">#gratitude</a></p>'
    )
    const tag = note.tag.first
    assert.strictEqual(
      tag.type,
      'https://www.w3.org/ns/activitystreams#Hashtag'
    )
    assert.strictEqual(tag.name.get(), '#gratitude')
  })
  it('can send an url', async () => {
    const content = 'Check out this link: https://example.com'
    const to = 'as:Public'
    note = await context.sendNote(content, { to })
    assert.ok(note)
    assert.strictEqual(
      note.content.get(),
      '<p>Check out this link: ' +
        '<a href="https://example.com">https://example.com</a></p>'
    )
  })
  it('can get an actor ID from a Webfinger ID', async () => {
    const webfinger = 'test3@social.example'
    const actorId = await context.toActorId(webfinger)
    assert.ok(actorId)
    assert.strictEqual(typeof actorId, 'string')
    assert.strictEqual(actorId, 'https://social.example/user/test3')
  })

  it('can get a Webfinger ID from an actor ID', async () => {
    const actorId = 'https://social.example/user/test4'
    const webfinger = await context.toWebfinger(actorId)
    assert.ok(webfinger)
    assert.strictEqual(typeof webfinger, 'string')
    assert.strictEqual(webfinger, 'test4@social.example')
  })

  it('can reply to a note', async () => {
    const noteIn = await makeObject('test5', 'Note', 1)
    const note = await context.sendReply('@test5@social.example OK', noteIn)
    assert.ok(note)
    assert.strictEqual(note.type, AS2_NS + 'Note')
    const actor = note.attributedTo?.first
    assert.strictEqual(actor.id, 'https://activitypubbot.example/user/test1')
    const recipients = [
      'https://social.example/user/test5',
      'https://www.w3.org/ns/activitystreams#Public'
    ]
    for (const addressee in note.to) {
      assert.ok(recipients.includes(addressee.id))
    }
    await context.onIdle()
    assert.strictEqual(postInbox.test5, 1)
  })

  it('can reply to self', async () => {
    const original = await context.sendNote("s'alright?", { to: 'as:Public' })
    const reply = await context.sendReply("@test1@activitypubbot.example s'alright.", original)
    assert.ok(reply)
    assert.strictEqual(reply.type, AS2_NS + 'Note')
    const actor = reply.attributedTo?.first
    assert.strictEqual(actor.id, 'https://activitypubbot.example/user/test1')
    const recipients = [
      'https://activitypubbot.example/user/test1',
      'https://www.w3.org/ns/activitystreams#Public'
    ]
    for (const addressee in reply.to) {
      assert.ok(recipients.includes(addressee.id))
    }
    await context.onIdle()
    assert.strictEqual(postInbox.test2, 2)
    let found = false
    for await (const item of actorStorage.items('test1', 'inbox')) {
      const full = await objectStorage.read(item.id)
      if (full.object?.first?.id === reply.id) {
        found = true
        break
      }
    }
    assert.ok(found)
  })

  it('does local delivery', async () => {
    const note = await context.sendNote('say OK please',
      { to: 'https://activitypubbot.example/user/ok' }
    )
    await context.onIdle()
    assert.ok(note)
    let found = null
    for await (const item of actorStorage.items('ok', 'inbox')) {
      const full = await objectStorage.read(item.id)
      if (full.object?.first?.id === note.id) {
        found = full
        break
      }
    }
    assert.ok(found)
    for await (const item of actorStorage.items('test1', 'inbox')) {
      const full = await objectStorage.read(item.id)
      if (full.object?.first?.inReplyTo?.first?.id === note.id) {
        found = full
        break
      }
    }
    assert.ok(found)
  })
})
