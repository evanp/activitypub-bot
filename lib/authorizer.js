import as2 from './activitystreams.js'

const NS = 'https://www.w3.org/ns/activitystreams#'

const PUBLICS = [
  `${NS}Public`,
  'as:Public',
  'Public'
]

const COLLECTION_TYPES = [
  `${NS}Collection`,
  `${NS}OrderedCollection`
]

export class Authorizer {
  #actorStorage = null
  #formatter = null
  #client = null
  constructor (actorStorage, formatter, client) {
    this.#actorStorage = actorStorage
    this.#formatter = formatter
    this.#client = client
  }

  async canRead (actor, object) {
    if (typeof object !== 'object') {
      throw new Error('object must be an object')
    }
    if (!('id' in object)) {
      throw new Error('object must have an id property')
    }
    if (typeof object.id !== 'string') {
      throw new Error('object.id must be a string')
    }
    return (this.#formatter.isLocal(object.id))
      ? await this.#canReadLocal(actor, object)
      : await this.#canReadRemote(actor, object)
  }

  async isOwner (actor, object) {
    const owner = await this.#getOwner(object)
    return actor.id === owner.id
  }

  async sameOrigin (actor, object) {
    const actorUrl = new URL(actor.id)
    const objectUrl = new URL(object.id)
    return actorUrl.origin === objectUrl.origin
  }

  async #canReadLocal (actor, object) {
    const recipients = this.#getRecipients(object)
    if (!actor) {
      return PUBLICS.some(id => recipients.has(id))
    }
    const ownerId = (await this.#getOwner(object))?.id
    if (!ownerId) {
      throw new Error(`no owner for ${object.id}`)
    }
    if (actor.id === ownerId) {
      return true
    }
    const owner = await this.#actorStorage.getActorById(ownerId)
    if (!owner) {
      throw new Error(`no actor for ${ownerId}`)
    }
    const ownerName = owner.get('preferredUsername')?.first
    if (!ownerName) {
      throw new Error(`no preferredUsername for ${owner.id}`)
    }
    if (await this.#actorStorage.isInCollection(ownerName, 'blocked', actor)) {
      return false
    }
    if (recipients.has(actor.id)) {
      return true
    }
    if (PUBLICS.some(id => recipients.has(id))) {
      return true
    }

    const lcolls = this.#getLocalCollections(recipients)

    for (const id of lcolls) {
      if (await this.#isInLocalCollection(actor, id)) {
        return true
      }
    }

    const rcolls = await this.#getRemoteCollections(recipients, ownerName)

    for (const id of rcolls) {
      if (await this.#isInRemoteCollection(actor, id, ownerName)) {
        return true
      }
    }

    return false
  }

  async #canReadRemote (actor, object) {
    const recipients = this.#getRecipients(object)
    if (!actor) {
      return PUBLICS.some(id => recipients.has(id))
    }
    if (recipients.has(actor.id)) {
      return true
    }
    if (PUBLICS.some(id => recipients.has(id))) {
      return true
    }
    // TODO: check if it's to followers, actor is local, and actor
    // is a follower
    // TODO: check if it's to a collection, and actor is in the
    // collection
    return null
  }

  async #getOwner (object) {
    if (object.attributedTo && object.attributedTo.first) {
      return object.attributedTo.first
    } else if (object.actor && object.actor.first) {
      return object.actor.first
    } else if (object.owner && object.owner.first) {
      return object.owner.first
    } else if (this.#formatter.isLocal(object.id)) {
      const parts = this.#formatter.unformat(object.id)
      return as2.import({
        id: this.#formatter.format({ username: parts.username })
      })
    } else {
      return null
    }
  }

  #getRecipients (activity) {
    const recipientIds = new Set()
    if (activity.to) {
      for (const to of activity.to) {
        recipientIds.add(to.id)
      }
    }
    if (activity.cc) {
      for (const cc of activity.cc) {
        recipientIds.add(cc.id)
      }
    }
    if (activity.audience) {
      for (const audience of activity.audience) {
        recipientIds.add(audience.id)
      }
    }
    if (activity.bto) {
      for (const bto of activity.bto) {
        recipientIds.add(bto.id)
      }
    }
    if (activity.bcc) {
      for (const bcc of activity.bcc) {
        recipientIds.add(bcc.id)
      }
    }
    return recipientIds
  }

  #getLocalCollections (recipients) {
    const lcolls = new Set()
    for (const recipient of recipients) {
      if (this.#isLocalCollection(recipient)) {
        lcolls.add(recipient)
      }
    }
    return lcolls
  }

  #isLocalCollection (recipient) {
    if (!this.#formatter.isLocal(recipient)) {
      return false
    } else {
      const parts = this.#formatter.unformat(recipient)
      return !!(parts.username && parts.collection && !parts.type)
    }
  }

  #isInLocalCollection (actor, recipient) {
    const parts = this.#formatter.unformat(recipient)
    return this.#actorStorage.isInCollection(
      parts.username,
      parts.collection,
      actor
    )
  }

  async #getRemoteCollections (recipients, ownerName) {
    const rcolls = new Set()
    for (const recipient of recipients) {
      if (await this.#isRemoteCollection(recipient, ownerName)) {
        rcolls.add(recipient)
      }
    }
    return rcolls
  }

  async #isRemoteCollection (recipient, ownerName) {
    if (this.#formatter.isLocal(recipient)) {
      return false
    } else {
      const obj = await this.#client.get(recipient, ownerName)

      return (Array.isArray(obj.type))
        ? obj.type.some(item => COLLECTION_TYPES.includes(item))
        : COLLECTION_TYPES.includes(obj.type)
    }
  }

  async #isInRemoteCollection (actor, id, ownerName) {
    const coll = await this.#client.get(id, ownerName)
    const collOwner = await this.#getOwner(coll)
    const collOwnerFull = await this.#client.get(collOwner.id, ownerName)

    // Special case for followers, following collections, since we track
    // that information locally, too

    if (this.#formatter.isLocal(actor.id)) {
      const { username } = this.#formatter.unformat(actor.id)
      if (coll.id === collOwnerFull.followers.first.id) {
        return await this.#actorStorage.isInCollection(username, 'following', collOwnerFull)
      } else if (coll.id === collOwnerFull.following.first.id) {
        return await this.#actorStorage.isInCollection(username, 'followers', collOwnerFull)
      }
    }

    // Worst case!

    for await (const item of this.#client.items(coll.id, ownerName)) {
      if (item.id === actor.id) {
        return true
      }
    }

    return false
  }
}
