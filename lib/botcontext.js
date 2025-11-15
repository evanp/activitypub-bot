import assert from 'node:assert'
import as2 from './activitystreams.js'
import { nanoid } from 'nanoid'
import fetch from 'node-fetch'

const AS2_TYPES = [
  'application/activity+json',
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
]

const WF_NS = 'https://purl.archive.org/socialweb/webfinger#'

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
    if (!thread && !inReplyTo) {
      thread = this.#formatter.format({ ...idProps, collection: 'thread' })
    }
    if (!context) {
      context = thread
    }
    if (!conversation) {
      conversation = thread
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
    const activity = await as2.import({
      type: 'Create',
      id: this.#formatter.format({
        username: this.#botId,
        type: 'create',
        nanoid: nanoid()
      }),
      actor: this.#formatter.format({ username: this.#botId }),
      to,
      cc,
      bto,
      bcc,
      audience,
      object: note
    })
    await this.#objectStorage.create(activity)
    await this.#actorStorage.addToCollection(this.#botId, 'outbox', activity)
    await this.#actorStorage.addToCollection(this.#botId, 'inbox', activity)
    await this.#distributor.distribute(activity, this.#botId)
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
    return await this.sendNote(content, { inReplyTo: object.id, ...r })
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
    const activity = await as2.import({
      type: 'Like',
      id: this.#formatter.format({
        username: this.#botId,
        type: 'like',
        nanoid: nanoid()
      }),
      actor: this.#formatter.format({ username: this.#botId }),
      object: obj.id,
      to: owners,
      cc: 'https://www.w3.org/ns/activitystreams#Public'
    })
    await this.#objectStorage.create(activity)
    await this.#actorStorage.addToCollection(this.#botId, 'outbox', activity)
    await this.#actorStorage.addToCollection(this.#botId, 'inbox', activity)
    await this.#actorStorage.addToCollection(this.#botId, 'liked', obj)
    await this.#distributor.distribute(activity, this.#botId)
    return activity
  }

  async unlikeObject (obj) {
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    const owners = obj.attributedTo
      ? Array.from(obj.attributedTo).map((owner) => owner.id)
      : Array.from(obj.actor).map((owner) => owner.id)
    if (!(await this.#actorStorage.isInCollection(this.#botId, 'liked', obj))) {
      throw new Error(`not already liked: ${obj.id} by ${this.#botId}`)
    }
    const likeActivity = this.#findInOutbox('Like', obj)
    if (!likeActivity) {
      throw new Error('no like activity')
    }
    const undoActivity = await as2.import({
      type: 'Undo',
      id: this.#formatter.format({
        username: this.#botId,
        type: 'undo',
        nanoid: nanoid()
      }),
      actor: this.#formatter.format({ username: this.#botId }),
      object: likeActivity,
      to: owners,
      cc: 'https://www.w3.org/ns/activitystreams#Public'
    })
    await this.#objectStorage.create(undoActivity)
    await this.#actorStorage.addToCollection(
      this.#botId,
      'outbox',
      undoActivity
    )
    await this.#actorStorage.addToCollection(
      this.#botId,
      'inbox',
      undoActivity
    )
    await this.#actorStorage.removeFromCollection(this.#botId, 'liked', obj)
    await this.#distributor.distribute(undoActivity, this.#botId)
    return undoActivity
  }

  async followActor (actor) {
    assert.ok(actor)
    assert.equal(typeof actor, 'object')
    const activity = await as2.import({
      type: 'Follow',
      id: this.#formatter.format({
        username: this.#botId,
        type: 'follow',
        nanoid: nanoid()
      }),
      actor: this.#formatter.format({ username: this.#botId }),
      object: actor.id,
      to: actor.id
    })
    await this.#objectStorage.create(activity)
    await this.#actorStorage.addToCollection(this.#botId, 'outbox', activity)
    await this.#actorStorage.addToCollection(this.#botId, 'inbox', activity)
    await this.#actorStorage.addToCollection(
      this.#botId,
      'pendingFollowing',
      actor
    )
    await this.#distributor.distribute(activity, this.#botId)
    return activity
  }

  async unfollowActor (actor) {
    assert.ok(actor)
    assert.equal(typeof actor, 'object')
    const followActivity = this.#findInOutbox('Follow', actor)
    if (!followActivity) {
      throw new Error('no follow activity')
    }
    const undoActivity = await as2.import({
      type: 'Undo',
      id: this.#formatter.format({
        username: this.#botId,
        type: 'undo',
        nanoid: nanoid()
      }),
      actor: this.#formatter.format({ username: this.#botId }),
      object: followActivity,
      to: actor.id
    })
    await this.#objectStorage.create(undoActivity)
    await this.#actorStorage.addToCollection(
      this.#botId,
      'outbox',
      undoActivity
    )
    await this.#actorStorage.addToCollection(
      this.#botId,
      'inbox',
      undoActivity
    )
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
    await this.#distributor.distribute(undoActivity, this.#botId)
    return undoActivity
  }

  async blockActor (actor) {
    assert.ok(actor)
    assert.equal(typeof actor, 'object')
    const activity = await as2.import({
      type: 'Block',
      id: this.#formatter.format({
        username: this.#botId,
        type: 'block',
        nanoid: nanoid()
      }),
      actor: this.#formatter.format({ username: this.#botId }),
      object: actor.id
    })
    await this.#objectStorage.create(activity)
    await this.#actorStorage.addToCollection(this.#botId, 'outbox', activity)
    await this.#actorStorage.addToCollection(this.#botId, 'inbox', activity)
    await this.#actorStorage.addToCollection(this.#botId, 'blocked', actor)
    for (const coll of [
      'following',
      'followers',
      'pendingFollowing',
      'pendingFollowers'
    ]) {
      await this.#actorStorage.removeFromCollection(this.#botId, coll, actor)
    }
    // Do not distribute!
    return activity
  }

  async unblockActor (actor) {
    assert.ok(actor)
    assert.equal(typeof actor, 'object')
    const blockActivity = this.#findInOutbox('Block', actor)
    if (!blockActivity) {
      throw new Error('no block activity')
    }
    const undoActivity = await as2.import({
      type: 'Undo',
      id: this.#formatter.format({
        username: this.#botId,
        type: 'undo',
        nanoid: nanoid()
      }),
      actor: this.#formatter.format({ username: this.#botId }),
      object: blockActivity
    })
    await this.#objectStorage.create(undoActivity)
    await this.#actorStorage.addToCollection(
      this.#botId,
      'outbox',
      undoActivity
    )
    await this.#actorStorage.addToCollection(
      this.#botId,
      'inbox',
      undoActivity
    )
    await this.#actorStorage.removeFromCollection(
      this.#botId,
      'blocked',
      actor
    )
    // Do not distribute!
    return undoActivity
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
    const activity = await as2.import({
      type: 'Update',
      id: this.#formatter.format({
        username: this.#botId,
        type: 'update',
        nanoid: nanoid()
      }),
      actor: this.#formatter.format({ username: this.#botId }),
      object: updated,
      to,
      cc,
      bto,
      bcc,
      audience
    })
    await this.#objectStorage.update(updated)
    await this.#objectStorage.create(activity)
    await this.#actorStorage.addToCollection(this.#botId, 'outbox', activity)
    await this.#actorStorage.addToCollection(this.#botId, 'inbox', activity)
    await this.#distributor.distribute(activity, this.#botId)
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
    const activity = await as2.import({
      type: 'Delete',
      id: this.#formatter.format({
        username: this.#botId,
        type: 'delete',
        nanoid: nanoid()
      }),
      actor: this.#formatter.format({ username: this.#botId }),
      object: tombstone,
      to,
      cc,
      bto,
      bcc,
      audience
    })
    await this.#objectStorage.update(tombstone)
    await this.#objectStorage.create(activity)
    await this.#actorStorage.addToCollection(this.#botId, 'outbox', activity)
    await this.#actorStorage.addToCollection(this.#botId, 'inbox', activity)
    await this.#distributor.distribute(activity, this.#botId)
    return activity
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
    const to = obj.to ? Array.from(obj.to).map((to) => to.id) : null
    const cc = obj.cc ? Array.from(obj.cc).map((cc) => cc.id) : null
    const bto = obj.bto ? Array.from(obj.bto).map((bto) => bto.id) : null
    const bcc = obj.bcc ? Array.from(obj.bcc).map((bcc) => bcc.id) : null
    const audience = obj.audience
      ? Array.from(obj.audience).map((audience) => audience.id)
      : null
    return { to, cc, bto, bcc, audience }
  }

  async onIdle () {
    await this.#distributor.onIdle()
  }
}
