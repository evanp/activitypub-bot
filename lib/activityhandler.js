import as2 from './activitystreams.js'
import { nanoid } from 'nanoid'

const AS2 = 'https://www.w3.org/ns/activitystreams#'

const THREAD_PROP = 'https://purl.archive.org/socialweb/thread#thread'

export class ActivityHandler {
  #actorStorage = null
  #objectStorage = null
  #distributor = null
  #cache = null
  #formatter = null
  #authz = null
  #logger = null
  #client = null
  constructor (
    actorStorage,
    objectStorage,
    distributor,
    formatter,
    cache,
    authz,
    logger,
    client
  ) {
    this.#actorStorage = actorStorage
    this.#objectStorage = objectStorage
    this.#distributor = distributor
    this.#formatter = formatter
    this.#cache = cache
    this.#authz = authz
    this.#logger = logger.child({ class: this.constructor.name })
    this.#client = client
  }

  async handleActivity (bot, activity) {
    switch (activity.type) {
      case AS2 + 'Create': await this.#handleCreate(bot, activity); break
      case AS2 + 'Update': await this.#handleUpdate(bot, activity); break
      case AS2 + 'Delete': await this.#handleDelete(bot, activity); break
      case AS2 + 'Add': await this.#handleAdd(bot, activity); break
      case AS2 + 'Remove': await this.#handleRemove(bot, activity); break
      case AS2 + 'Follow': await this.#handleFollow(bot, activity); break
      case AS2 + 'Accept': await this.#handleAccept(bot, activity); break
      case AS2 + 'Reject': await this.#handleReject(bot, activity); break
      case AS2 + 'Like': await this.#handleLike(bot, activity); break
      case AS2 + 'Announce': await this.#handleAnnounce(bot, activity); break
      case AS2 + 'Undo': await this.#handleUndo(bot, activity); break
      case AS2 + 'Block': await this.#handleBlock(bot, activity); break
      case AS2 + 'Flag': await this.#handleFlag(bot, activity); break
      default:
        this.#logger.warn(`Unhandled activity type: ${activity.type}`)
    }
  }

  async #handleCreate (bot, activity) {
    const actor = this.#getActor(activity)
    if (!actor) {
      this.#logger.warn(
        { activity: activity.id },
        'Create activity has no actor'
      )
      return
    }
    const object = this.#getObject(activity)
    if (!object) {
      this.#logger.warn(
        { activity: activity.id },
        'Create activity has no object'
      )
      return
    }
    if (await this.#authz.sameOrigin(activity, object)) {
      await this.#cache.save(object)
    } else {
      await this.#cache.saveReceived(object)
    }
    await this.#handleCreateReplies(bot, activity, actor, object)
    await this.#handleCreateThread(bot, activity, actor, object)
    if (this.#isMention(bot, object)) {
      this.#logger.debug(
         { username: bot.username, object: object.id },
        'bot mentioned'
      )
      await bot.onMention(object, activity)
    }
  }

  async #handleCreateReplies (bot, activity, actor, object) {
    const inReplyTo = object.inReplyTo?.first
    if (
      inReplyTo &&
      this.#formatter.isLocal(inReplyTo.id)
    ) {
      let original = null
      try {
        original = await this.#objectStorage.read(inReplyTo.id)
      } catch (err) {
        this.#logger.warn(
          'Create activity references not found original object',
          { activity: activity.id, original: inReplyTo.id }
        )
        return
      }
      if (this.#authz.isOwner(await this.#botActor(bot), original)) {
        if (!await this.#authz.canRead(actor, original)) {
          this.#logger.warn(
            'Create activity references inaccessible original object',
            { activity: activity.id, original: original.id }
          )
          return
        }
        if (await this.#objectStorage.isInCollection(original.id, 'replies', object)) {
          this.#logger.warn(
            'Create activity object already in replies collection',
            {
              activity: activity.id,
              object: object.id,
              original: original.id
            }
          )
          return
        }
        await this.#objectStorage.addToCollection(
          original.id,
          'replies',
          object
        )
        const recipients = this.#getRecipients(original)
        this.#addRecipient(recipients, actor, 'to')
        await this.#doActivity(bot, {
          type: 'Add',
          object,
          target: original.replies,
          ...recipients
        })
      }
    }
  }

  async #handleCreateThread (bot, activity, actor, object) {
    const thread = await this.#objectThread(object)
    if (!thread) {
      this.#logger.warn(
        'Object has no thread',
        { object: object.id }
      )
      return
    }
    if (!this.#formatter.isLocal(thread.id)) {
      this.#logger.warn(
        'Not a local thread',
        { thread: thread.id }
      )
      return
    }
    const root = await this.#threadRoot(thread)
    if (root && this.#formatter.isLocal(root.id)) {
      if (this.#authz.isOwner(await this.#botActor(bot), root)) {
        if (!await this.#authz.canRead(actor, root)) {
          this.#logger.warn(
            'Create activity references inaccessible root object',
            { activity: activity.id, root: root.id }
          )
          return
        }
        if (await this.#objectStorage.isInCollection(root.id, 'thread', object)) {
          this.#logger.warn(
            'Create activity object already in replies collection',
            {
              activity: activity.id,
              object: object.id,
              root: root.id
            }
          )
          return
        }
        await this.#objectStorage.addToCollection(
          root.id,
          'thread',
          object
        )
        const recipients = this.#getRecipients(root)
        this.#addRecipient(recipients, actor, 'to')
        await this.#doActivity(bot, {
          type: 'Add',
          object,
          target: root.thread,
          ...recipients
        })
      }
    }
  }

  async #handleUpdate (bot, activity) {
    const object = this.#getObject(activity)
    if (await this.#authz.sameOrigin(activity, object)) {
      await this.#cache.save(object)
    } else {
      await this.#cache.saveReceived(object)
    }
  }

  async #handleDelete (bot, activity) {
    const object = this.#getObject(activity)
    await this.#cache.clear(object)
  }

  async #handleAdd (bot, activity) {
    const actor = this.#getActor(activity)
    const target = this.#getTarget(activity)
    const object = this.#getObject(activity)
    if (await this.#authz.sameOrigin(actor, object)) {
      await this.#cache.save(object)
    } else {
      await this.#cache.saveReceived(object)
    }
    if (await this.#authz.sameOrigin(actor, target)) {
      await this.#cache.save(target)
      await this.#cache.saveMembership(target, object)
    } else {
      await this.#cache.saveReceived(target)
      await this.#cache.saveMembershipReceived(target, object)
    }
  }

  async #handleRemove (bot, activity) {
    const actor = this.#getActor(activity)
    const target = this.#getTarget(activity)
    const object = this.#getObject(activity)
    if (await this.#authz.sameOrigin(actor, object)) {
      await this.#cache.save(object)
    } else {
      await this.#cache.saveReceived(object)
    }
    if (await this.#authz.sameOrigin(actor, target)) {
      await this.#cache.save(target)
      await this.#cache.saveMembership(target, object, false)
    } else {
      await this.#cache.saveReceived(target)
      await this.#cache.saveMembershipReceived(target, object, false)
    }
  }

  async #handleFollow (bot, activity) {
    const actor = this.#getActor(activity)
    const object = this.#getObject(activity)
    if (object.id !== this.#botId(bot)) {
      this.#logger.warn({
        msg: 'Follow activity object is not the bot',
        activity: activity.id,
        object: object.id
      })
      return
    }
    if (await this.#actorStorage.isInCollection(bot.username, 'blocked', actor)) {
      this.#logger.warn({
        msg: 'Follow activity from blocked actor',
        activity: activity.id,
        actor: actor.id
      })
      return
    }
    if (await this.#actorStorage.isInCollection(bot.username, 'followers', actor)) {
      this.#logger.warn({
        msg: 'Duplicate follow activity',
        activity: activity.id,
        actor: actor.id
      })
      return
    }
    this.#logger.info({
      msg: 'Adding follower',
      actor: actor.id
    })
    await this.#actorStorage.addToCollection(bot.username, 'followers', actor)
    this.#logger.info(
      'Sending accept',
      { actor: actor.id }
    )
    await this.#doActivity(bot, {
      type: 'Add',
      object: actor,
      target: this.#formatter.format({
        username: bot.username,
        collection: 'followers'
      }),
      to: ['as:Public', actor.id]
    })
    await this.#doActivity(bot, {
      type: 'Accept',
      object: activity,
      to: actor
    })
    this.#logger.debug({
      msg: 'Notifying bot of new follow',
      actor: actor.id
    })
    await bot.onFollow(actor, activity)
  }

  async #handleAccept (bot, activity) {
    let objectActivity = this.#getObject(activity)
    if (!this.#formatter.isLocal(objectActivity.id)) {
      this.#logger.warn({ msg: 'Accept activity for a non-local activity' })
      return
    }
    try {
      objectActivity = await this.#objectStorage.read(objectActivity.id)
    } catch (err) {
      this.#logger.warn({ msg: 'Accept activity object not found' })
      return
    }
    switch (objectActivity.type) {
      case AS2 + 'Follow':
        await this.#handleAcceptFollow(bot, activity, objectActivity)
        break
      default:
        console.log('Unhandled accept', objectActivity.type)
        break
    }
  }

  async #handleAcceptFollow (bot, activity, followActivity) {
    const actor = this.#getActor(activity)
    if (
      !(await this.#actorStorage.isInCollection(
        bot.username,
        'pendingFollowing',
        followActivity
      ))
    ) {
      this.#logger.warn({ msg: 'Accept activity object not found' })
      return
    }
    if (await this.#actorStorage.isInCollection(bot.username, 'following', actor)) {
      this.#logger.warn({ msg: 'Already following' })
      return
    }
    if (await this.#actorStorage.isInCollection(bot.username, 'blocked', actor)) {
      this.#logger.warn({ msg: 'blocked' })
      return
    }
    const object = this.#getObject(followActivity)
    if (object.id !== actor.id) {
      this.#logger.warn({ msg: 'Object does not match actor' })
      return
    }
    this.#logger.info({ msg: 'Adding to following' })
    await this.#actorStorage.addToCollection(bot.username, 'following', actor)
    await this.#actorStorage.removeFromCollection(
      bot.username,
      'pendingFollowing',
      followActivity
    )
    await this.#doActivity(bot, {
      type: 'Add',
      object: actor,
      target: this.#formatter.format({
        username: bot.username,
        collection: 'following'
      }),
      to: ['as:Public', actor.id]
    })
  }

  async #handleReject (bot, activity) {
    let objectActivity = this.#getObject(activity)
    if (!this.#formatter.isLocal(objectActivity.id)) {
      this.#logger.warn({ msg: 'Reject activity for a non-local activity' })
      return
    }
    try {
      objectActivity = await this.#objectStorage.read(objectActivity.id)
    } catch (err) {
      this.#logger.warn({ msg: 'Reject activity object not found' })
      return
    }
    switch (objectActivity.type) {
      case AS2 + 'Follow':
        await this.#handleRejectFollow(bot, activity, objectActivity)
        break
      default:
        this.#logger.warn({ msg: 'Unhandled reject' })
        break
    }
  }

  async #handleRejectFollow (bot, activity, followActivity) {
    const actor = this.#getActor(activity)
    if (
      !(await this.#actorStorage.isInCollection(
        bot.username,
        'pendingFollowing',
        followActivity
      ))
    ) {
      this.#logger.warn({ msg: 'Reject activity object not found' })
      return
    }
    if (await this.#actorStorage.isInCollection(bot.username, 'following', actor)) {
      this.#logger.warn({ msg: 'Already following' })
      return
    }
    if (await this.#actorStorage.isInCollection(bot.username, 'blocked', actor)) {
      this.#logger.warn({ msg: 'blocked' })
      return
    }
    const object = this.#getObject(followActivity)
    if (object.id !== actor.id) {
      this.#logger.warn({ msg: 'Object does not match actor' })
      return
    }
    this.#logger.info({ msg: 'Removing from pending' })
    await this.#actorStorage.removeFromCollection(
      bot.username,
      'pendingFollowing',
      followActivity
    )
  }

  async #handleLike (bot, activity) {
    const actor = this.#getActor(activity)
    let object = this.#getObject(activity)
    if (!this.#formatter.isLocal(object.id)) {
      this.#logger.warn({
        msg: 'Like activity object is not local',
        activity: activity.id,
        object: object.id
      })
      return
    }
    try {
      object = await this.#objectStorage.read(object.id)
    } catch (err) {
      this.#logger.warn({
        msg: 'Like activity object not found',
        activity: activity.id,
        object: object.id
      })
      return
    }
    if (!(await this.#authz.canRead(actor, object))) {
      this.#logger.warn({
        msg: 'Like activity object is not readable',
        activity: activity.id,
        object: object.id
      })
      return
    }
    const owner = this.#getOwner(object)
    if (!owner || owner.id !== this.#botId(bot)) {
      this.#logger.warn({
        msg: 'Like activity object is not owned by bot',
        activity: activity.id,
        object: object.id
      })
      return
    }
    if (await this.#objectStorage.isInCollection(object.id, 'likes', activity)) {
      this.#logger.warn({
        msg: 'Like activity already in likes collection',
        activity: activity.id,
        object: object.id
      })
      return
    }
    if (await this.#objectStorage.isInCollection(object.id, 'likers', actor)) {
      this.#logger.warn({
        msg: 'Actor already in likers collection',
        activity: activity.id,
        actor: actor.id,
        object: object.id
      })
      return
    }
    await this.#objectStorage.addToCollection(object.id, 'likes', activity)
    await this.#objectStorage.addToCollection(object.id, 'likers', actor)
    const recipients = this.#getRecipients(object)
    this.#addRecipient(recipients, actor, 'to')
    const parts = this.#formatter.unformat(object.id)
    const likesCollectionId = this.#formatter.format({
      username: parts.username,
      type: parts.type,
      nanoid: parts.nanoid,
      collection: 'likes'
    })
    await this.#doActivity(bot, {
      type: 'Add',
      object: activity,
      target: likesCollectionId,
      ...recipients
    })
    await bot.onLike(object, activity)
  }

  async #handleAnnounce (bot, activity) {
    const actor = this.#getActor(activity)
    let object = this.#getObject(activity)
    if (!this.#formatter.isLocal(object.id)) {
      this.#logger.warn({
        msg: 'Announce activity object is not local',
        activity: activity.id,
        object: object.id
      })
      return
    }
    try {
      object = await this.#objectStorage.read(object.id)
    } catch (err) {
      this.#logger.warn({
        msg: 'Announce activity object not found',
        activity: activity.id,
        object: object.id
      })
      return
    }
    const owner = this.#getOwner(object)
    if (!owner || owner.id !== this.#botId(bot)) {
      this.#logger.warn({
        msg: 'Announce activity object is not owned by bot',
        activity: activity.id,
        object: object.id
      })
      return
    }
    if (!(await this.#authz.canRead(actor, object))) {
      this.#logger.warn({
        msg: 'Announce activity object is not readable',
        activity: activity.id,
        object: object.id
      })
      return
    }
    if (await this.#objectStorage.isInCollection(object.id, 'shares', activity)) {
      this.#logger.warn({
        msg: 'Announce activity already in shares collection',
        activity: activity.id,
        object: object.id
      })
      return
    }
    if (await this.#objectStorage.isInCollection(object.id, 'sharers', actor)) {
      this.#logger.warn({
        msg: 'Actor already in sharers collection',
        activity: activity.id,
        actor: actor.id,
        object: object.id
      })
      return
    }
    await this.#objectStorage.addToCollection(object.id, 'shares', activity)
    await this.#objectStorage.addToCollection(object.id, 'sharers', actor)
    const recipients = this.#getRecipients(object)
    this.#addRecipient(recipients, actor, 'to')
    await this.#doActivity(bot, {
      type: 'Add',
      object: activity,
      target: this.#formatter.format({
        username: bot.username,
        collection: 'shares'
      }),
      ...recipients
    })
    try {
      await bot.onAnnounce(object, activity)
    } catch (err) {
      this.#logger.warn(
        `Error notifying bot of announce: ${err.message}`,
        { err, username: bot.username, activity: activity.id }
      )
    }
  }

  async #handleBlock (bot, activity) {
    const actor = this.#getActor(activity)
    const object = this.#getObject(activity)
    if (object.id === this.#botId(bot)) {
      // These skip if not found
      await this.#actorStorage.removeFromCollection(
        bot.username,
        'followers',
        actor
      )
      await this.#actorStorage.removeFromCollection(
        bot.username,
        'following',
        actor
      )
      await this.#actorStorage.removeFromCollection(
        bot.username,
        'pendingFollowing',
        actor
      )
      await this.#actorStorage.removeFromCollection(
        bot.username,
        'pendingFollowers',
        actor
      )
    }
  }

  async #handleFlag (bot, activity) {
    const actor = this.#getActor(activity)
    const object = this.#getObject(activity)
    this.#logger.warn(`Actor ${actor.id} flagged object ${object.id} for review.`)
  }

  async #handleUndo (bot, undoActivity) {
    const undoActor = this.#getActor(undoActivity)
    let activity = await this.#getObject(undoActivity)
    if (!activity) {
      this.#logger.warn({
        msg: 'Undo activity has no object',
        activity: undoActivity.id
      })
      return
    }
    activity = await this.#ensureProps(bot, undoActivity, activity, ['type'])
    this.#logger.debug({ activityType: activity.type })
    if (await this.#authz.sameOrigin(undoActivity, activity)) {
      this.#logger.info({
        msg: 'Assuming undo activity can undo an activity with same origin',
        undoActivity: undoActivity.id,
        activity: activity.id
      })
    } else {
      activity = await this.#ensureProps(bot, undoActivity, activity, ['actor'])
      const activityActor = this.#getActor(activity)
      if (undoActor.id !== activityActor.id) {
        this.#logger.warn({
          msg: 'Undo activity actor does not match object activity actor',
          activity: undoActivity.id,
          object: activity.id
        })
        return
      }
    }
    switch (activity.type) {
      case AS2 + 'Like':
        await this.#handleUndoLike(bot, undoActivity, activity)
        break
      case AS2 + 'Announce':
        await this.#handleUndoAnnounce(bot, undoActivity, activity)
        break
      case AS2 + 'Block':
        await this.#handleUndoBlock(bot, undoActivity, activity)
        break
      case AS2 + 'Follow':
        await this.#handleUndoFollow(bot, undoActivity, activity)
        break
      default:
        this.#logger.warn({
          msg: 'Unhandled undo',
          undoActivity: undoActivity.id,
          activity: activity.id,
          type: activity.type
        })
        break
    }
  }

  async #handleUndoLike (bot, undoActivity, likeActivity) {
    const actor = this.#getActor(undoActivity)
    likeActivity = await this.#ensureProps(bot, undoActivity, likeActivity, ['object'])
    let object = this.#getObject(likeActivity)
    if (!this.#formatter.isLocal(object.id)) {
      this.#logger.warn({
        msg: 'Undo activity object is not local',
        activity: undoActivity.id,
        likeActivity: likeActivity.id,
        object: object.id
      })
      return
    }
    try {
      object = await this.#objectStorage.read(object.id)
    } catch (err) {
      this.#logger.warn({
        msg: 'Like activity object not found',
        activity: undoActivity.id,
        likeActivity: likeActivity.id,
        object: object.id
      })
      return
    }
    if (!(await this.#authz.canRead(actor, object))) {
      this.#logger.warn({
        msg: 'Like activity object is not readable',
        activity: undoActivity.id,
        likeActivity: likeActivity.id,
        object: object.id
      })
      return
    }
    this.#logger.info({
      msg: 'Removing like',
      actor: actor.id,
      object: object.id,
      likeActivity: likeActivity.id,
      undoActivity: undoActivity.id
    })
    await this.#objectStorage.removeFromCollection(object.id, 'likes', likeActivity)
    await this.#objectStorage.removeFromCollection(object.id, 'likers', actor)
  }

  async #handleUndoAnnounce (bot, undoActivity, shareActivity) {
    const actor = this.#getActor(undoActivity)
    shareActivity = await this.#ensureProps(bot, undoActivity, shareActivity, ['object'])
    let object = this.#getObject(shareActivity)
    if (!this.#formatter.isLocal(object.id)) {
      this.#logger.warn({
        msg: 'Undo activity object is not local',
        activity: undoActivity.id,
        shareActivity: shareActivity.id,
        object: object.id
      })
      return
    }
    try {
      object = await this.#objectStorage.read(object.id)
    } catch (err) {
      this.#logger.warn({
        msg: 'Share activity object not found',
        activity: undoActivity.id,
        shareActivity: shareActivity.id,
        object: object.id
      })
      return
    }
    if (!(await this.#authz.canRead(actor, object))) {
      this.#logger.warn({
        msg: 'Share activity object is not readable',
        activity: undoActivity.id,
        shareActivity: shareActivity.id,
        object: object.id
      })
      return
    }
    this.#logger.info({
      msg: 'Removing share',
      actor: actor.id,
      object: object.id,
      shareActivity: shareActivity.id,
      undoActivity: undoActivity.id
    })
    await this.#objectStorage.removeFromCollection(object.id, 'shares', shareActivity)
    await this.#objectStorage.removeFromCollection(object.id, 'sharers', actor)
  }

  async #handleUndoBlock (bot, undoActivity, blockActivity) {
    const actor = this.#getActor(undoActivity)
    blockActivity = await this.#ensureProps(bot, undoActivity, blockActivity, ['object'])
    const object = this.#getObject(blockActivity)
    if (object.id !== this.#botId(bot)) {
      this.#logger.warn({
        msg: 'Block activity object is not the bot',
        activity: undoActivity.id,
        object: object.id
      })
    } else {
      this.#logger.info({
        msg: 'Block removed',
        actor: actor.id,
        undoActivity: undoActivity.id,
        blockActivity: blockActivity.id,
        object: object.id
      })
    }
  }

  async #handleUndoFollow (bot, undoActivity, followActivity) {
    const actor = this.#getActor(undoActivity)
    followActivity = await this.#ensureProps(bot, undoActivity, followActivity, ['object'])
    const object = this.#getObject(followActivity)
    if (object.id !== this.#botId(bot)) {
      this.#logger.warn({
        msg: 'Follow activity object is not the bot',
        activity: undoActivity.id,
        object: object.id
      })
      return
    }
    if (!(await this.#actorStorage.isInCollection(bot.username, 'followers', actor))) {
      this.#logger.warn({
        msg: 'Undo follow activity from actor not in followers',
        activity: undoActivity.id,
        followActivity: followActivity.id,
        actor: actor.id
      })
      return
    }
    await this.#actorStorage.removeFromCollection(bot.username, 'followers', actor)
    await this.#actorStorage.removeFromCollection(bot.username, 'pendingFollowers', actor)
  }

  async onIdle () {
    await this.#distributor.onIdle()
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

  #removeRecipient (recipients, actor) {
    const remove = (list) => {
      if (!list) {
        return
      }
      const index = list.indexOf(actor.id)
      if (index !== -1) {
        list.splice(index, 1)
      }
    }
    remove(recipients.to)
    remove(recipients.cc)
    remove(recipients.bto)
    remove(recipients.bcc)
    remove(recipients.audience)
  }

  #addRecipient (recipients, actor, key = 'to') {
    if (!actor.id) {
      return
    }
    if (!recipients[key]) {
      recipients[key] = []
    }
    if (recipients[key].indexOf(actor.id) === -1) {
      recipients[key].push(actor.id)
    }
  }

  async #doActivity (bot, activityData) {
    const now = new Date().toISOString()
    const activity = await as2.import({
      ...activityData,
      id: this.#formatActivityId(bot, activityData.type),
      actor: {
        id: this.#botId(bot),
        name: bot.fullname,
        type: 'Service'
      },
      published: now,
      updated: now
    })
    await this.#objectStorage.create(activity)
    await this.#actorStorage.addToCollection(bot.username, 'outbox', activity)
    await this.#actorStorage.addToCollection(bot.username, 'inbox', activity)
    await this.#distributor.distribute(activity, bot.username)
  }

  #formatActivityId (bot, type) {
    const typeName = this.#activityTypeName(type)
    return this.#formatter.format({
      username: bot.username,
      type: typeName,
      nanoid: nanoid()
    })
  }

  #activityTypeName (type) {
    if (!type || typeof type !== 'string') {
      return 'activity'
    }
    const parts = type.split(/[\/#]/)
    return parts[parts.length - 1].toLowerCase()
  }

  #getActor (activity) {
    return activity.actor?.first
  }

  #getObject (activity) {
    return activity.object?.first
  }

  #getTarget (activity) {
    return activity.target?.first
  }

  #getOwner (object) {
    if (object.attributedTo) {
      return object.attributedTo.first
    } else if (object.actor) {
      return object.actor.first
    } else if (object.owner) {
      return object.owner.first
    } else {
      return null
    }
  }

  async #ensureProps (bot, source, object, required = ['id']) {
    const others = required.filter((prop) => prop !== 'id' && prop !== 'type')
    if (!object.id) {
      return null
    }
    this.#logger.debug({ msg: 'Ensuring object', source: source.id, object: object.id, required })
    // Try getting the object from the source
    if (this.#authz.sameOrigin(source, object) &&
      (!required.includes('type') || object.type) &&
      !others.find((prop) => !object.has(prop))) {
      this.#logger.debug('Object is already complete')
      return object
    }
    // Check if it is a local object
    if (this.#formatter.isLocal(object.id)) {
      this.#logger.debug({ msg: 'Checking local', object: object.id })
      object = await this.#objectStorage.read(object.id)
      if (object &&
        (!required.includes('type') || object.type) &&
        !others.find((prop) => !object.has(prop))) {
        this.#logger.debug('Object fetched from storage')
        return object
      } else {
        return null
      }
    } else {
      // Check it from cache
      const id = object.id
      this.#logger.debug({ msg: 'Checking cache', object: id })
      object = await this.#cache.get(id)
      if (object &&
        (!required.includes('type') || object.type) &&
        !others.find((prop) => !object.has(prop))) {
        this.#logger.debug('Object fetched from cache')
        return object
      }
      // Fetch it from the Web
      this.#logger.debug({ msg: 'Checking remote', object: id })
      object = await this.#client.get(id, bot.username)
      this.#logger.debug({ msg: 'Object fetched from remote', object: object.id, objectText: await object.write() })
      this.#cache.save(object)
      if (object &&
        (!required.includes('type') || object.type) &&
        !others.find((prop) => !object.has(prop))) {
        this.#logger.debug({ msg: 'Object fetched from remote is correct', object: object.id, objectText: await object.write() })
        return object
      }
      return null
    }
  }

  #botId (bot) {
    return this.#formatter.format({ username: bot.username })
  }

  async #botActor (bot) {
    return await as2.import({
      id: this.#formatter.format({ username: bot.username }),
      name: bot.fullname,
      type: 'Service'
    })
  }

  #isMention (bot, object) {
    if (!object.tag) {
      return false
    }
    const url = this.#formatter.format({ username: bot.username })
    for (const tag of object.tag) {
      if (tag.type === AS2 + 'Mention' && tag.href === url) {
        return true
      }
    }
    return false
  }

  async #objectThread (object) {
    const threadProp = object.get(THREAD_PROP)
    if (threadProp) {
      return Array.from(threadProp)[0]
    }
    const contextProp = object.get('context')
    if (contextProp) {
      return Array.from(contextProp)[0]
    }
    const inReplyTo = object.inReplyTo?.first
    if (
      inReplyTo &&
      this.#formatter.isLocal(inReplyTo.id)
    ) {
      const inReplyToObject = await this.#objectStorage.read(inReplyTo.id)
      return await this.#objectThread(inReplyToObject)
    }
    return null
  }

  async #threadRoot (thread) {
    const parts = this.#formatter.unformat(thread.id)
    if (parts.username && parts.type && parts.nanoid && parts.collection === 'thread') {
      const id = this.#formatter.format(
        { username: parts.username, type: parts.type, nanoid: parts.nanoid }
      )
      return await this.#objectStorage.read(id)
    } else {
      return null
    }
  }
}
