import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { BotContext } from '../lib/botcontext.js'
import { BotDataStorage } from '../lib/botdatastorage.js'
import { ObjectStorage } from '../lib/objectstorage.js'
import { KeyStorage } from '../lib/keystorage.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { ActivityDistributor } from '../lib/activitydistributor.js'
import { ActorStorage } from '../lib/actorstorage.js'
import { Transformer } from '../lib/microsyntax.js'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'
import {
  nockSetup,
  postInbox,
  resetInbox,
  makeActor,
  makeObject,
  nockFormat
} from '@evanp/activitypub-nock'
import Logger from 'pino'
import as2 from '../lib/activitystreams.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { Digester } from '../lib/digester.js'

const AS2_NS = 'https://www.w3.org/ns/activitystreams#'
const LOCAL_HOST = 'local.botcontext.test'
const REMOTE_HOST = 'social.botcontext.test'
const LOCAL_ORIGIN = `https://${LOCAL_HOST}`
const REMOTE_ORIGIN = `https://${REMOTE_HOST}`
const BOT_USERNAME = 'botcontexttest1'
const LOCAL_OK_USERNAME = 'botcontexttestok'
const REMOTE_USER_2 = 'botcontextremote2'
const REMOTE_USER_3 = 'botcontextremote3'
const REMOTE_USER_4 = 'botcontextremote4'
const REMOTE_USER_5 = 'botcontextremote5'
const REMOTE_USER_6 = 'botcontextremote6'
const REMOTE_USER_7 = 'botcontextremote7'
const REMOTE_USER_8 = 'botcontextremote8'
const REMOTE_USER_9 = 'botcontextremote9'
const REMOTE_USER_10 = 'botcontextremote10'
const REMOTE_ACTOR_10 = 'botcontextactor10'
const DUPLICATE_USERNAME = 'botcontextdupe1'
const TEST_USERNAMES = [BOT_USERNAME, LOCAL_OK_USERNAME, DUPLICATE_USERNAME]

function makeActorDefault (username, domain = REMOTE_HOST) {
  return makeActor(username, domain)
}

function makeObjectDefault (username, type, num, domain = REMOTE_HOST) {
  return makeObject(username, type, num, domain)
}

function nockFormatDefault (params) {
  return nockFormat(params.domain ? params : { domain: REMOTE_HOST, ...params })
}

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
  const botName = BOT_USERNAME
  before(async () => {
    logger = Logger({
      level: 'silent'
    })
    formatter = new UrlFormatter(LOCAL_ORIGIN)
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
    botDataStorage = new BotDataStorage(connection)
    objectStorage = new ObjectStorage(connection)
    keyStorage = new KeyStorage(connection, logger)
    actorStorage = new ActorStorage(connection, formatter)
    const signer = new HTTPSignature(logger)
    const digester = new Digester(logger)
    client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
    distributor = new ActivityDistributor(client, formatter, actorStorage, logger)
    transformer = new Transformer(`${LOCAL_ORIGIN}/tag/`, client)
    await objectStorage.create(
      await as2.import({
        id: formatter.format({
          username: botName,
          type: 'object',
          nanoid: '_pEWsKke-7lACTdM3J_qd'
        }),
        type: 'Object',
        attributedTo: formatter.format({ username: botName }),
        to: 'https://www.w3.org/ns/activitystreams#Public'
      })
    )
    nockSetup(REMOTE_HOST)
  })
  after(async () => {
    await cleanupTestData(connection, {
      usernames: TEST_USERNAMES,
      localDomain: LOCAL_HOST,
      remoteDomains: [REMOTE_HOST]
    })
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
    transformer = null
    logger = null
  })
  beforeEach(async () => {
    resetInbox()
  })
  it('can initialize', async () => {
    context = new BotContext(
      botName,
      botDataStorage,
      objectStorage,
      actorStorage,
      client,
      distributor,
      formatter,
      transformer,
      logger
    )
  })
  it('can get the bot ID', () => {
    assert.strictEqual(context.botId, botName)
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
  it('can return the correct flag for an unset key', async () => {
    const result = await context.hasData('doesnotexist')
    assert.strictEqual(result, false)
  })
  it('can return the correct flag for a set key', async () => {
    await context.setData('setkey', 'value')
    const result = await context.hasData('setkey')
    assert.strictEqual(result, true)
  })
  it('can get a local object', async () => {
    const id = formatter.format({
      username: botName,
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
    const id = `${REMOTE_ORIGIN}/user/${REMOTE_USER_2}/object/1`
    const object = await context.getObject(id)
    assert.ok(object)
    assert.strictEqual(object.id, id)
    assert.strictEqual(
      object.type,
      'https://www.w3.org/ns/activitystreams#Object'
    )
  })
  it('can send a note', async () => {
    const actor2 = await makeActorDefault(REMOTE_USER_2)
    await actorStorage.addToCollection(botName, 'followers', actor2)
    let followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 1)
    const content = 'Hello World'
    const to = followers.id
    note = await context.sendNote(content, { to })
    assert.ok(note)
    assert.strictEqual(note.type, 'https://www.w3.org/ns/activitystreams#Note')
    assert.strictEqual(await note.content.get(), `<p>${content}</p>`)
    const iter = note.attributedTo[Symbol.iterator]()
    const actor = iter.next().value
    assert.strictEqual(actor.id, `${LOCAL_ORIGIN}/user/${BOT_USERNAME}`)
    const iter2 = note.to[Symbol.iterator]()
    const noteTo = iter2.next().value
    assert.strictEqual(noteTo.id, to)
    assert.strictEqual(typeof note.published, 'object')
    assert.strictEqual(typeof note.id, 'string')
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_2], 1)
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 1)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 1)
    followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can like an object', async () => {
    const id = `${REMOTE_ORIGIN}/user/${REMOTE_USER_2}/object/1`
    const obj = await context.getObject(id)
    await context.likeObject(obj)
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_2], 1)
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 2)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 2)
    const liked = await actorStorage.getCollection(botName, 'liked')
    assert.strictEqual(liked.totalItems, 1)
  })
  it('can unlike an object', async () => {
    const id = `${REMOTE_ORIGIN}/user/${REMOTE_USER_2}/object/1`
    const obj = await context.getObject(id)
    await context.unlikeObject(obj)
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_2], 1)
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 3)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 3)
    const liked = await actorStorage.getCollection(botName, 'liked')
    assert.strictEqual(liked.totalItems, 0)
  })
  it('can follow an actor', async () => {
    actor3 = await makeActorDefault(REMOTE_USER_3)
    await context.followActor(actor3)
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_3], 1)
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 4)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 4)
    const pendingFollowing = await actorStorage.getCollection(
      botName,
      'pendingFollowing'
    )
    assert.strictEqual(pendingFollowing.totalItems, 1)
  })
  it('can unfollow a pending actor', async () => {
    await context.unfollowActor(actor3)
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_3], 1)
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 5)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 5)
    const pendingFollowing = await actorStorage.getCollection(
      botName,
      'pendingFollowing'
    )
    assert.strictEqual(pendingFollowing.totalItems, 0)
  })
  it('can unfollow a followed actor', async () => {
    const actor4 = await makeActorDefault(REMOTE_USER_4)
    await context.followActor(actor4)
    await context.onIdle()
    await actorStorage.removeFromCollection(botName, 'pendingFollowing', actor4)
    await actorStorage.addToCollection(botName, 'following', actor4)
    let following = await actorStorage.getCollection(botName, 'following')
    assert.strictEqual(following.totalItems, 1)
    await context.unfollowActor(actor4)
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_4], 2)
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 7)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 7)
    following = await actorStorage.getCollection(botName, 'following')
    assert.strictEqual(following.totalItems, 0)
  })
  it('can block an actor without a relationship', async () => {
    let followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 1)
    actor5 = await makeActorDefault(REMOTE_USER_5)
    await context.blockActor(actor5)
    await context.onIdle()
    assert.ok(!postInbox[REMOTE_USER_5])
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 8)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 8)
    const blocked = await actorStorage.getCollection(botName, 'blocked')
    assert.strictEqual(blocked.totalItems, 1)
    followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can unblock an actor without a relationship', async () => {
    let followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 1)
    await context.unblockActor(actor5)
    await context.onIdle()
    assert.ok(!postInbox[REMOTE_USER_5])
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 9)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 9)
    const blocked = await actorStorage.getCollection(botName, 'blocked')
    assert.strictEqual(blocked.totalItems, 0)
    followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can block an actor with a relationship', async () => {
    actor6 = await makeActorDefault(REMOTE_USER_6)
    let followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 1)
    await actorStorage.addToCollection(botName, 'following', actor6)
    await actorStorage.addToCollection(botName, 'followers', actor6)
    followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 2)
    await context.blockActor(actor6)
    await context.onIdle()
    assert.ok(!postInbox[REMOTE_USER_6])
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 10)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 10)
    const blocked = await actorStorage.getCollection(botName, 'blocked')
    assert.strictEqual(blocked.totalItems, 1)
    const following = await actorStorage.getCollection(botName, 'following')
    assert.strictEqual(following.totalItems, 0)
    followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can unblock an actor with a former relationship', async () => {
    await context.unblockActor(actor6)
    assert.ok(!postInbox[REMOTE_USER_6])
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 11)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 11)
    const blocked = await actorStorage.getCollection(botName, 'blocked')
    assert.strictEqual(blocked.totalItems, 0)
    const following = await actorStorage.getCollection(botName, 'following')
    assert.strictEqual(following.totalItems, 0)
    const followers = await actorStorage.getCollection(botName, 'followers')
    assert.strictEqual(followers.totalItems, 1)
  })
  it('can update a note', async () => {
    const content = 'Hello World 2'
    await context.updateNote(note, content)
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_2], 1)
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 12)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 12)
    const copy = await context.getObject(note.id)
    assert.strictEqual(copy.content.get(), content)
  })
  it('can delete a note', async () => {
    await context.deleteNote(note)
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_2], 1)
    const outbox = await actorStorage.getCollection(botName, 'outbox')
    assert.strictEqual(outbox.totalItems, 13)
    const inbox = await actorStorage.getCollection(botName, 'inbox')
    assert.strictEqual(inbox.totalItems, 13)
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
    const id = `${REMOTE_ORIGIN}/user/${REMOTE_USER_2}/object/2`
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
    const id = `${REMOTE_ORIGIN}/user/${REMOTE_USER_2}/object/3`
    const obj = await context.getObject(id)
    try {
      await context.unlikeObject(obj)
      assert.fail('Expected an error')
    } catch (error) {
      assert.ok(true)
    }
  })
  it('can send a reply', async () => {
    const actor3 = await makeActorDefault(REMOTE_USER_3)
    const object = await makeObjectDefault(REMOTE_USER_7, 'Note', 1)
    const content = `@${REMOTE_USER_2}@${REMOTE_HOST} hello back`
    const to = [actor3.id, 'as:Public']
    const inReplyTo = object.id
    note = await context.sendNote(content, { to, inReplyTo })
    assert.ok(note)
    assert.strictEqual(note.type, 'https://www.w3.org/ns/activitystreams#Note')
    assert.strictEqual(
      await note.content.get(),
      '<p>' +
        `<a href="${REMOTE_ORIGIN}/profile/${REMOTE_USER_2}">` +
        `@${REMOTE_USER_2}@${REMOTE_HOST}` +
        '</a> hello back</p>'
    )
    const iter = note.attributedTo[Symbol.iterator]()
    const actor = iter.next().value
    assert.strictEqual(actor.id, `${LOCAL_ORIGIN}/user/${BOT_USERNAME}`)
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
    assert.strictEqual(tag.href, `${REMOTE_ORIGIN}/profile/${REMOTE_USER_2}`)
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
        `<a href="${LOCAL_ORIGIN}/tag/gratitude">#gratitude</a></p>`
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
    const webfinger = `${REMOTE_USER_3}@${REMOTE_HOST}`
    const actorId = await context.toActorId(webfinger)
    assert.ok(actorId)
    assert.strictEqual(typeof actorId, 'string')
    assert.strictEqual(actorId, `${REMOTE_ORIGIN}/user/${REMOTE_USER_3}`)
  })

  it('can get a Webfinger ID from an actor ID', async () => {
    const actorId = `${REMOTE_ORIGIN}/user/${REMOTE_USER_4}`
    const webfinger = await context.toWebfinger(actorId)
    assert.ok(webfinger)
    assert.strictEqual(typeof webfinger, 'string')
    assert.strictEqual(webfinger, `${REMOTE_USER_4}@${REMOTE_HOST}`)
  })

  it('can reply to a note', async () => {
    const noteIn = await makeObjectDefault(REMOTE_USER_5, 'Note', 1)
    const note = await context.sendReply(`@${REMOTE_USER_5}@${REMOTE_HOST} OK`, noteIn)
    assert.ok(note)
    assert.strictEqual(note.type, AS2_NS + 'Note')
    const actor = note.attributedTo?.first
    assert.strictEqual(actor.id, `${LOCAL_ORIGIN}/user/${BOT_USERNAME}`)
    const recipients = [
      `${REMOTE_ORIGIN}/user/${REMOTE_USER_5}`,
      'https://www.w3.org/ns/activitystreams#Public'
    ]
    for (const addressee in note.to) {
      assert.ok(recipients.includes(addressee.id))
    }
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_5], 1)
  })

  it('can reply to self', async () => {
    const followers = await actorStorage.getCollection(botName, 'followers')
    const original = await context.sendNote("s'alright?", { to: followers.id })
    const reply = await context.sendReply(`@${BOT_USERNAME}@${LOCAL_HOST} s'alright.`, original)
    assert.ok(reply)
    assert.strictEqual(reply.type, AS2_NS + 'Note')
    const actor = reply.attributedTo?.first
    assert.strictEqual(actor.id, `${LOCAL_ORIGIN}/user/${BOT_USERNAME}`)
    const recipients = [
      `${LOCAL_ORIGIN}/user/${BOT_USERNAME}`,
      followers.id
    ]
    for (const addressee in reply.to) {
      assert.ok(recipients.includes(addressee.id))
    }
    await context.onIdle()
    assert.strictEqual(postInbox[REMOTE_USER_2], 2)
    let found = false
    for await (const item of actorStorage.items(botName, 'inbox')) {
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
      { to: `${LOCAL_ORIGIN}/user/${LOCAL_OK_USERNAME}` }
    )
    await context.onIdle()
    assert.ok(note)
    let found = null
    for await (const item of actorStorage.items(LOCAL_OK_USERNAME, 'inbox')) {
      const full = await objectStorage.read(item.id)
      if (full.object?.first?.id === note.id) {
        found = full
        break
      }
    }
    assert.ok(found)
    for await (const item of actorStorage.items(botName, 'inbox')) {
      const full = await objectStorage.read(item.id)
      if (full.object?.first?.inReplyTo?.first?.id === note.id) {
        found = full
        break
      }
    }
    assert.ok(found)
  })

  it('has a working logger', async () => {
    assert.ok(context.logger)
    assert.doesNotThrow(() => context.logger.debug('debug'))
    assert.doesNotThrow(() => context.logger.info('info'))
    assert.doesNotThrow(() => context.logger.warn('warn'))
    assert.doesNotThrow(() => context.logger.error('error'))
  })

  describe('reactions in new content', async () => {
    let note = null
    before(async () => {
      const content = 'Hello World'
      const to = 'https://www.w3.org/ns/activitystreams#Public'
      note = await context.sendNote(content, { to })
    })

    it('has a replies property', async () => {
      const repliesProp = note.get('replies')
      assert.ok(repliesProp)
      const replieses = Array.from(repliesProp)
      assert.strictEqual(replieses.length, 1)
      const replies = replieses[0]
      assert.ok(replies.id)
    })

    it('has a shares property', async () => {
      const sharesProp = note.get('shares')
      assert.ok(sharesProp)
      const shareses = Array.from(sharesProp)
      assert.strictEqual(shareses.length, 1)
      const shares = shareses[0]
      assert.ok(shares.id)
    })

    it('has a likes property', async () => {
      const likesProp = note.get('likes')
      assert.ok(likesProp)
      const likeses = Array.from(likesProp)
      assert.strictEqual(likeses.length, 1)
      const likes = likeses[0]
      assert.ok(likes.id)
    })
  })

  describe('threads in new content', async () => {
    let note = null
    before(async () => {
      const content = 'Hello World'
      const to = 'https://www.w3.org/ns/activitystreams#Public'
      note = await context.sendNote(content, { to })
    })

    it('has a thread property', async () => {
      const threadProp = note.get('https://purl.archive.org/socialweb/thread#thread')
      assert.ok(threadProp)
      const threads = Array.from(threadProp)
      assert.strictEqual(threads.length, 1)
      const thread = threads[0]
      assert.ok(thread.id)
    })

    it('has a context property', async () => {
      const contextProp = note.get('context')
      assert.ok(contextProp)
      const contexts = Array.from(contextProp)
      assert.strictEqual(contexts.length, 1)
      const context = contexts[0]
      assert.ok(context.id)
    })

    it('has an ostatus:conversation property', async () => {
      const conversationProp = note.get('http://ostatus.org/schema/1.0/conversation')
      assert.ok(conversationProp)
      const conversations = Array.from(conversationProp)
      assert.strictEqual(conversations.length, 1)
      const conversation = conversations[0]
      assert.ok(conversation)
    })
  })

  describe('reactions in a reply', async () => {
    let note = null
    before(async () => {
      const noteIn = await makeObjectDefault(REMOTE_USER_8, 'Note', 1)
      const content = `@${REMOTE_USER_8}@${REMOTE_HOST} OK`
      note = await context.sendReply(content, noteIn)
    })

    it('has a replies property', async () => {
      const repliesProp = note.get('replies')
      assert.ok(repliesProp)
      const replieses = Array.from(repliesProp)
      assert.strictEqual(replieses.length, 1)
      const replies = replieses[0]
      assert.ok(replies.id)
    })

    it('has a shares property', async () => {
      const sharesProp = note.get('shares')
      assert.ok(sharesProp)
      const shareses = Array.from(sharesProp)
      assert.strictEqual(shareses.length, 1)
      const shares = shareses[0]
      assert.ok(shares.id)
    })

    it('has a likes property', async () => {
      const likesProp = note.get('likes')
      assert.ok(likesProp)
      const likeses = Array.from(likesProp)
      assert.strictEqual(likeses.length, 1)
      const likes = likeses[0]
      assert.ok(likes.id)
    })
  })

  describe('threads in a reply', async () => {
    let note = null
    let noteIn = null
    before(async () => {
      noteIn = await makeObjectDefault(REMOTE_USER_8, 'Note', 2)
      const content = `@${REMOTE_USER_8}@${REMOTE_HOST} OK`
      note = await context.sendReply(content, noteIn)
    })

    it('has a matching thread property', async () => {
      const propName = 'https://purl.archive.org/socialweb/thread#thread'
      const threadProp = note.get(propName)
      assert.ok(threadProp)
      const threads = Array.from(threadProp)
      assert.strictEqual(threads.length, 1)
      const thread = threads[0]
      assert.ok(thread.id)
      const threadIn = Array.from(noteIn.get(propName))[0]
      assert.strictEqual(thread.id, threadIn.id)
    })

    it('has a matching context property', async () => {
      const propName = 'context'
      const contextProp = note.get(propName)
      assert.ok(contextProp)
      const contexts = Array.from(contextProp)
      assert.strictEqual(contexts.length, 1)
      const context = contexts[0]
      assert.ok(context.id)
      const contextIn = Array.from(noteIn.get(propName))[0]
      assert.strictEqual(context.id, contextIn.id)
    })

    it('has a matching ostatus:conversation property', async () => {
      const propName = 'http://ostatus.org/schema/1.0/conversation'
      const conversationProp = note.get(propName)
      assert.ok(conversationProp)
      const conversations = Array.from(conversationProp)
      assert.strictEqual(conversations.length, 1)
      const conversation = conversations[0]
      assert.ok(conversation)
      const conversationIn = Array.from(noteIn.get(propName))[0]
      assert.strictEqual(context.id, conversationIn.id)
    })
  })

  it('can duplicate', async () => {
    const username = DUPLICATE_USERNAME
    let dupe = null
    dupe = await context.duplicate(username)
    assert.ok(dupe)
    assert.strictEqual(dupe.botId, username)
  })

  it('can announce an object', async () => {
    const username = REMOTE_USER_9
    const type = 'Note'
    const num = 3035

    const id = nockFormatDefault({ username, type, num })

    const obj = await context.getObject(id)
    const activity = await context.announceObject(obj)

    assert.ok(activity)

    assert.strictEqual(activity.type, `${AS2_NS}Announce`)
    assert.strictEqual(activity.object?.first?.id, obj.id)

    await context.onIdle()

    assert.strictEqual(postInbox[username], 1)

    let foundInOutbox = false
    for await (const item of actorStorage.items(botName, 'outbox')) {
      if (item.id === activity.id) {
        foundInOutbox = true
        break
      }
    }
    assert.ok(foundInOutbox)

    let foundInInbox = false
    for await (const item of actorStorage.items(botName, 'inbox')) {
      if (item.id === activity.id) {
        foundInInbox = true
        break
      }
    }
    assert.ok(foundInInbox)
  })

  it('can unannounce an object', async () => {
    const username = REMOTE_USER_10
    const type = 'Note'
    const num = 13633

    const id = nockFormatDefault({ username, type, num })

    const obj = await context.getObject(id)
    const activity = await context.announceObject(obj)

    assert.ok(activity)

    const undo = await context.unannounceObject(obj)

    assert.strictEqual(undo.type, `${AS2_NS}Undo`)
    assert.strictEqual(undo.object?.first?.id, activity.id)
    assert.strictEqual(undo.object?.first?.object?.first?.id, obj.id)
    assert.ok(undo.to)
    assert.ok(undo.cc)

    await context.onIdle()

    assert.strictEqual(postInbox[username], 2)

    let foundInOutbox = false
    for await (const item of actorStorage.items(botName, 'outbox')) {
      if (item.id === undo.id) {
        foundInOutbox = true
        break
      }
    }

    assert.ok(foundInOutbox)

    let foundInInbox = false
    for await (const item of actorStorage.items(botName, 'inbox')) {
      if (item.id === undo.id) {
        foundInInbox = true
        break
      }
    }
    assert.ok(foundInInbox)
  })

  it('can do an arbitrary activity', async () => {
    const username = REMOTE_ACTOR_10
    const actorId = nockFormatDefault({ username })

    const activity = await context.doActivity({
      to: actorId,
      type: 'IntransitiveActivity'
    })

    assert.strictEqual(activity.type, `${AS2_NS}IntransitiveActivity`)

    await context.onIdle()

    assert.strictEqual(postInbox[username], 1)

    let foundInOutbox = false
    for await (const item of actorStorage.items(botName, 'outbox')) {
      if (item.id === activity.id) {
        foundInOutbox = true
        break
      }
    }
    assert.ok(foundInOutbox)

    let foundInInbox = false
    for await (const item of actorStorage.items(botName, 'inbox')) {
      if (item.id === activity.id) {
        foundInInbox = true
        break
      }
    }
    assert.ok(foundInInbox)
  })
})
