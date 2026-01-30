import assert from 'node:assert'
import as2 from './activitystreams.js'
import { nanoid } from 'nanoid'
import fetch from 'node-fetch'

const AS2_TYPES = [
  'application/activity+json',
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
]

const WF_NS = 'https://purl.archive.org/socialweb/webfinger#'

const THREAD_PROP = 'https://purl.archive.org/socialweb/thread#thread'
const CONVERSATION_PROP = 'http://ostatus.org/schema/1.0/conversation'

export class BotContext {
  #botId = null
  #botDataStorage = null
  #objectStorage = null
  #actorStorage = null
  #client = null
  #distributor = null
  #formatter = null
  #transformer = null
  #logger = null
  get botId () {
    return this.#botId
  }

  get logger () {
    return this.#logger
  }

  constructor (
    botId,
    botDataStorage,
    objectStorage,
    actorStorage,
    client,
    distributor,
    formatter,
    transformer,
    logger
  ) {
    this.#botId = botId
    this.#botDataStorage = botDataStorage
    this.#objectStorage = objectStorage
    this.#actorStorage = actorStorage
    this.#client = client
    this.#distributor = distributor
    this.#formatter = formatter
    this.#transformer = transformer
    this.#logger = logger.child({ class: 'BotContext', botId })
  }

  // copy constructor

  async duplicate (username) {
    return new this.constructor(
      username,
      this.#botDataStorage,
      this.#objectStorage,
      this.#actorStorage,
      this.#client,
      this.#distributor,
      this.#formatter,
      this.#transformer,
      this.#logger
    )
  }

  async setData (key, value) {
    await this.#botDataStorage.set(this.#botId, key, value)
  }

  async getData (key) {
    return await this.#botDataStorage.get(this.#botId, key)
  }

  async deleteData (key) {
    await this.#botDataStorage.delete(this.#botId, key)
  }

  async hasData (key) {
    return await this.#botDataStorage.has(this.#botId, key)
  }

  async getObject (id) {
    assert.ok(id)
    assert.equal(typeof id, 'string')
    if (this.#formatter.isLocal(id)) {
      return await this.#objectStorage.read(id)
    } else {
      return await this.#client.get(id, this.#botId)
    }
  }

  async sendNote (content, { to, cc, bto, bcc, audience, inReplyTo, thread, context, conversation }) {
    assert.ok(content)
    assert.equal(typeof content, 'string')
    assert.ok(to || cc || bto || bcc || audience)
    const { html, tag } = await this.#transformer.transform(content)
    const noteNanoid = nanoid()
    const idProps = {
      username: this.#botId,
      type: 'note',
      nanoid: noteNanoid
    }
    if (!inReplyTo) {
      if (!thread) {
        thread = this.#formatter.format({ ...idProps, collection: 'thread' })
      }
      if (!context) {
        context = thread
      }
      if (!conversation) {
        conversation = thread
      }
    }
    const note = await as2.import({
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://purl.archive.org/socialweb/thread/1.0',
        { ostatus: 'http://ostatus.org/schema/1.0/' }
      ],
      type: 'Note',
      content: html,
      tag,
      to,
      cc,
      bto,
      bcc,
      audience,
      inReplyTo,
      id: this.#formatter.format(idProps),
      replies: this.#formatter.format({ ...idProps, collection: 'replies' }),
      shares: this.#formatter.format({ ...idProps, collection: 'shares' }),
      likes: this.#formatter.format({ ...idProps, collection: 'likes' }),
      context,
      thread,
      'ostatus:conversation': conversation,
      published: new Date().toISOString(),
      attributedTo: this.#formatter.format({ username: this.#botId })
    })
    await this.#objectStorage.create(note)
    const activity = await this.#doActivity({
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://purl.archive.org/socialweb/thread/1.0',
        { ostatus: 'http://ostatus.org/schema/1.0/' }
      ],
      type: 'Create',
      to,
      cc,
      bto,
      bcc,
      audience,
      object: note
    })
    return note
  }

  async sendReply (content, object) {
    const r = this.#getRecipients(object)
    const attributedTo = object.attributedTo?.first?.id
    if (r.to) {
      r.to.push(attributedTo)
    } else {
      r.to = [attributedTo]
    }
    const full = this.#formatter.format({ username: this.#botId })
    for (const prop in ['to', 'cc', 'bto', 'bcc', 'audience']) {
      if (r[prop]) {
        r[prop] = r[prop].filter(id => id !== full)
      }
    }
    const opt = { inReplyTo: object.id, ...r }

    const threadProp = object.get(THREAD_PROP)
    if (threadProp) {
      opt.thread = Array.from(threadProp)[0].id
    }
    const contextProp = object.get('context')
    if (contextProp) {
      opt.context = Array.from(contextProp)[0].id
    }
    const conversationProp = object.get(CONVERSATION_PROP)
    if (conversationProp) {
      opt.conversation = Array.from(conversationProp)[0]
    }
    return await this.sendNote(content, opt)
  }

  async likeObject (obj) {
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    if (await this.#actorStorage.isInCollection(this.#botId, 'liked', obj)) {
      throw new Error(`already liked: ${obj.id} by ${this.#botId}`)
    }
    const owners = obj.attributedTo
      ? Array.from(obj.attributedTo).map((owner) => owner.id)
      : Array.from(obj.actor).map((owner) => owner.id)
    await this.#actorStorage.addToCollection(this.#botId, 'liked', obj)
    const activity = await this.#doActivity({
      type: 'Like',
      object: obj.id,
      to: owners,
      cc: 'https://www.w3.org/ns/activitystreams#Public'
    })
    await this.#actorStorage.setLastActivity(this.#botId, activity)
    return activity
  }

  async unlikeObject (obj) {
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    if (!(await this.#actorStorage.isInCollection(this.#botId, 'liked', obj))) {
      throw new Error(`not already liked: ${obj.id} by ${this.#botId}`)
    }
    await this.#actorStorage.removeFromCollection(this.#botId, 'liked', obj)
    return await this.#undoActivity('Like', obj)
  }

  async followActor (actor) {
    assert.ok(actor)
    assert.equal(typeof actor, 'object')
    await this.#actorStorage.addToCollection(
      this.#botId,
      'pendingFollowing',
      actor
    )
    const activity = await this.#doActivity({
      type: 'Follow',
      object: actor.id,
      to: actor.id
    })
    await this.#actorStorage.setLastActivity(this.#botId, activity)
    return activity
  }

  async unfollowActor (actor) {
    assert.ok(actor)
    assert.equal(typeof actor, 'object')
    await this.#actorStorage.removeFromCollection(
      this.#botId,
      'pendingFollowing',
      actor
    )
    await this.#actorStorage.removeFromCollection(
      this.#botId,
      'following',
      actor
    )
    return await this.#undoActivity('Follow', actor)
  }

  async blockActor (actor) {
    assert.ok(actor)
    assert.equal(typeof actor, 'object')
    await this.#actorStorage.addToCollection(this.#botId, 'blocked', actor)
    for (const coll of [
      'following',
      'followers',
      'pendingFollowing',
      'pendingFollowers'
    ]) {
      await this.#actorStorage.removeFromCollection(this.#botId, coll, actor)
    }
    const activity = await this.#doActivity({
      type: 'Block',
      object: actor.id
    }, false)
    await this.#actorStorage.setLastActivity(this.#botId, activity)
    return activity
  }

  async unblockActor (actor) {
    assert.ok(actor)
    assert.equal(typeof actor, 'object')
    await this.#actorStorage.removeFromCollection(this.#botId, 'blocked', actor)
    return await this.#undoActivity('Block', actor, false)
  }

  async updateNote (note, content) {
    assert.ok(note)
    assert.equal(typeof note, 'object')
    assert.ok(content)
    assert.equal(typeof content, 'string')
    const exported = await note.export({ useOriginalContext: true })
    exported.content = content
    const updated = await as2.import(exported)
    const { to, cc, bto, bcc, audience } = this.#getRecipients(note)
    await this.#objectStorage.update(updated)
    await this.#doActivity({
      type: 'Update',
      object: updated,
      to,
      cc,
      bto,
      bcc,
      audience
    })
    return updated
  }

  async deleteNote (note) {
    assert.ok(note)
    assert.equal(typeof note, 'object')
    const { to, cc, bto, bcc, audience } = this.#getRecipients(note)
    const tombstone = await as2.import({
      type: 'Tombstone',
      id: note.id,
      attributedTo: this.#formatter.format({ username: this.#botId }),
      formerType: 'Note',
      deleted: new Date().toISOString(),
      to,
      cc,
      bto,
      bcc,
      audience
    })
    await this.#objectStorage.update(tombstone)
    return await this.#doActivity({
      type: 'Delete',
      object: tombstone,
      to,
      cc,
      bto,
      bcc,
      audience
    })
  }

  async toActorId (webfinger) {
    const [, domain] = webfinger.split('@')
    const url = `https://${domain}/.well-known/webfinger` +
      `?resource=acct:${webfinger}`
    const res = await fetch(url)
    if (res.status !== 200) {
      throw new Error(`Status ${res.status} fetching ${url}`)
    }
    const json = await res.json()
    const link = json?.links?.find(
      (l) => l.rel === 'self' && AS2_TYPES.includes(l.type)
    )
    return link ? link.href : null
  }

  async toWebfinger (actorId) {
    const actor = await this.#client.get(actorId)
    if (!actor) {
      return null
    }
    const wf = actor.get(WF_NS + 'webfinger')
    if (wf) {
      return wf.value()
    }
    const username = actor.get('preferredUsername')?.first
    if (!username) {
      return null
    }
    const actorUrl = new URL(actor.id)
    return `${username}@${actorUrl.hostname}`
  }

  async announceObject (obj) {
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    const owners = obj.attributedTo
      ? Array.from(obj.attributedTo).map((owner) => owner.id)
      : Array.from(obj.actor).map((owner) => owner.id)
    const activity = await this.#doActivity({
      type: 'Announce',
      summary: {
        en: `${this.#botId} shared "${await this.#nameOf(obj)}"`
      },
      object: obj.id,
      to: [
        this.#formatter.format({
          username: this.#botId,
          collection: 'followers'
        }),
        'https://www.w3.org/ns/activitystreams#Public'
      ],
      cc: owners
    })
    await this.#actorStorage.setLastActivity(this.#botId, activity)
    return activity
  }

  async unannounceObject (obj) {
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    return await this.#undoActivity('Announce', obj)
  }

  async doActivity (data, distribute = true) {
    assert.ok(data)
    assert.equal(typeof data, 'object')
    return await this.#doActivity(data, distribute)
  }

  async #findInOutbox (type, obj) {
    const full = `https://www.w3.org/ns/activitystreams#${type}`
    let found = null
    for await (const activity of this.#actorStorage.items(
      this.#botId,
      'outbox'
    )) {
      if (activity.type === full && activity.object.id === obj.id) {
        found = activity
        break
      }
    }
    return found
  }

  #getRecipients (obj) {
    assert.ok(obj)
    assert.strictEqual(typeof obj, 'object', 'obj must be an object')
    const to = obj.to ? Array.from(obj.to).map((to) => to.id) : null
    const cc = obj.cc ? Array.from(obj.cc).map((cc) => cc.id) : null
    const bto = obj.bto ? Array.from(obj.bto).map((bto) => bto.id) : null
    const bcc = obj.bcc ? Array.from(obj.bcc).map((bcc) => bcc.id) : null
    const audience = obj.audience
      ? Array.from(obj.audience).map((audience) => audience.id)
      : null
    return { to, cc, bto, bcc, audience }
  }

  #nameOf (obj) {
    if (obj.name) {
      return obj.name.valueOf()
    } else if (obj.summary) {
      return obj.summary.valueOf()
    } else if (obj.type) {
      return `a(n) ${obj.type.first}`
    } else {
      return 'an object'
    }
  }

  async #doActivity (activityData, distribute = true) {
    const now = new Date().toISOString()
    const type = activityData.type || 'Activity'
    const activity = await as2.import({
      ...activityData,
      type,
      id: this.#formatter.format({
        username: this.#botId,
        type: type,
        nanoid: nanoid()
      }),
      actor: {
        id: this.#formatter.format({ username: this.#botId }),
        type: 'Service'
      },
      published: now,
      updated: now
    })
    await this.#objectStorage.create(activity)
    await this.#actorStorage.addToCollection(this.#botId, 'outbox', activity)
    await this.#actorStorage.addToCollection(this.#botId, 'inbox', activity)
    if (distribute) {
      await this.#distributor.distribute(activity, this.#botId)
    }
    return activity
  }

  async #undoActivity (type, obj, distribute = true) {
    const originalId = await this.#actorStorage.getLastActivity(
      this.#botId,
      type,
      obj
    )
    if (!originalId) {
      throw new Error(`no ${type} activity for ${obj.id}`)
    }
    const originalActivity = await this.#objectStorage.read(originalId)
    assert.ok(originalActivity)
    const recipients = this.#getRecipients(originalActivity)
    return await this.#doActivity({
      type: 'Undo',
      object: {
        id: originalId,
        type,
        object: {
          id: obj.id,
          type: obj.type
        }
      },
      ...recipients
    }, distribute)
  }

  async onIdle () {
    await this.#distributor.onIdle()
  }
}
