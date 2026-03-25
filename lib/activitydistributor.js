import assert from 'node:assert'

import { LRUCache } from 'lru-cache'

import as2 from './activitystreams.js'

const NS = 'https://www.w3.org/ns/activitystreams#'

const COLLECTION_TYPES = [
  `${NS}Collection`,
  `${NS}OrderedCollection`
]

export class ActivityDistributor {
  static #DISTRIBUTION_QUEUE_ID = 'distribution'
  static #DELIVERY_QUEUE_ID = 'delivery'
  static #MAX_CACHE_SIZE = 1000000
  static #PUBLIC = [
    'https://www.w3.org/ns/activitystreams#Public',
    'as:Public',
    'Public'
  ]

  #client = null
  #formatter = null
  #actorStorage = null
  #directInboxCache = null
  #sharedInboxCache = null
  #logger = null
  #jobQueue = null

  constructor (client, formatter, actorStorage, logger, jobQueue) {
    assert.ok(client)
    assert.ok(formatter)
    assert.ok(actorStorage)
    assert.ok(logger)
    assert.ok(jobQueue)
    this.#client = client
    this.#formatter = formatter
    this.#actorStorage = actorStorage
    this.#logger = logger.child({ class: this.constructor.name })
    this.#jobQueue = jobQueue
    this.#directInboxCache = new LRUCache({ max: ActivityDistributor.#MAX_CACHE_SIZE })
    this.#sharedInboxCache = new LRUCache({ max: ActivityDistributor.#MAX_CACHE_SIZE })
  }

  async distribute (activity, username) {
    const stripped = await this.#strip(activity)
    const raw = await stripped.export()
    const actorId = this.#formatter.format({ username })

    const delivered = new Set()
    const localDelivered = new Set()

    for await (const recipient of this.#public(activity, username)) {
      if (await this.#isLocal(recipient)) {
        if (recipient !== actorId && !localDelivered.has(recipient)) {
          localDelivered.add(recipient)
          const parts = this.#formatter.unformat(recipient)
          await this.#jobQueue.enqueue(
            ActivityDistributor.#DELIVERY_QUEUE_ID,
            { botUsername: parts.username, activity: raw }
          )
        }
      } else {
        const inbox = await this.#getInbox(recipient, username)
        if (!inbox) {
          this.#logger.warn({ id: recipient.id }, 'No inbox')
        } else if (!delivered.has(inbox)) {
          delivered.add(inbox)
          await this.#jobQueue.enqueue(
            ActivityDistributor.#DISTRIBUTION_QUEUE_ID,
            { inbox, activity: raw, username }
          )
        }
      }
    }

    for await (const recipient of this.#private(activity, username)) {
      if (await this.#isLocal(recipient)) {
        if (recipient !== actorId && !localDelivered.has(recipient)) {
          localDelivered.add(recipient)
          const parts = this.#formatter.unformat(recipient)
          await this.#jobQueue.enqueue(
            ActivityDistributor.#DELIVERY_QUEUE_ID,
            { botUsername: parts.username, activity: raw }
          )
        }
      } else {
        const inbox = await this.#getDirectInbox(recipient, username)
        if (!inbox) {
          this.#logger.warn({ id: recipient.id }, 'No direct inbox')
        } else if (!delivered.has(inbox)) {
          delivered.add(inbox)
          await this.#jobQueue.enqueue(
            ActivityDistributor.#DISTRIBUTION_QUEUE_ID,
            { inbox, activity: raw, username }
          )
        }
      }
    }
  }

  async onIdle () {
    await this.#jobQueue.onIdle(ActivityDistributor.#DELIVERY_QUEUE_ID)
    await this.#jobQueue.onIdle(ActivityDistributor.#DISTRIBUTION_QUEUE_ID)
  }

  async * #public (activity, username) {
    yield * this.#recipients(activity, username, ['to', 'cc', 'audience'])
  }

  async * #private (activity, username) {
    yield * this.#recipients(activity, username, ['bto', 'bcc'])
  }

  async * #recipients (activity, username, props) {
    for (const prop of props) {
      const p = activity.get(prop)
      if (p) {
        for (const value of p) {
          const id = value.id
          this.#logger.debug({ id }, 'Checking recipient')
          if (ActivityDistributor.#PUBLIC.includes(id)) {
            this.#logger.debug(
              { activity: activity.id },
              'Skipping public delivery'
            )
          } else if (this.#formatter.isLocal(id)) {
            this.#logger.debug({ id }, 'Unformatting local recipient')
            const parts = this.#formatter.unformat(id)
            this.#logger.debug(parts, 'Local recipient')
            if (this.#isLocalActor(parts)) {
              this.#logger.debug({ id }, 'Local actor')
              yield id
            } else if (this.#isLocalCollection(parts)) {
              this.#logger.debug({ id }, 'Local collection')
              for await (const item of this.#actorStorage.items(parts.username, parts.collection)) {
                this.#logger.debug({ id: item.id }, 'Local collection member')
                yield item.id
              }
            } else {
              this.#logger.warn({ id }, 'Local non-actor non-collection')
            }
          } else {
            let obj
            try {
              obj = await this.#client.get(id, username)
            } catch (err) {
              this.#logger.warn({ id, err }, 'Cannot get recipient, skipping')
              continue
            }
            if (this.#isRemoteActor(obj)) {
              this.#logger.debug({ id }, 'Remote actor')
              yield id
            } else if (this.#isRemoteCollection(obj)) {
              this.#logger.debug({ id }, 'Remote collection')
              try {
                for await (const item of this.#client.items(obj.id, username)) {
                  this.#logger.debug({ id: item.id }, 'Remote collection member')
                  yield item.id
                }
              } catch (err) {
                this.#logger.warn({ id, err }, 'Cannot iterate, skipping')
                continue
              }
            } else {
              this.#logger.warn({ id }, 'Remote non-actor non-collection')
            }
          }
        }
      }
    }
  }

  async #getInbox (actorId, username) {
    assert.ok(actorId)
    assert.equal(typeof actorId, 'string')
    assert.ok(username)
    assert.equal(typeof username, 'string')

    let sharedInbox = this.#sharedInboxCache.get(actorId)

    if (sharedInbox) {
      return sharedInbox
    }

    const obj = await this.#client.get(actorId, username)

    // Get the shared inbox if it exists

    const endpoints = obj.get('endpoints')
    if (endpoints) {
      const firstEndpoint = Array.from(endpoints)[0]
      const sharedInboxEndpoint = firstEndpoint.get('sharedInbox')
      if (sharedInboxEndpoint) {
        const firstSharedInbox = Array.from(sharedInboxEndpoint)[0]
        sharedInbox = firstSharedInbox.id
        this.#sharedInboxCache.set(actorId, sharedInbox)
        return sharedInbox
      }
    }

    let directInbox = this.#directInboxCache.get(actorId)
    if (directInbox) {
      return directInbox
    }

    if (!obj.inbox) {
      return null
    }
    const inboxes = Array.from(obj.inbox)
    if (inboxes.length === 0) {
      return null
    }
    directInbox = inboxes[0].id
    this.#directInboxCache.set(actorId, directInbox)
    return directInbox
  }

  async #getDirectInbox (actorId, username) {
    assert.ok(actorId)
    assert.equal(typeof actorId, 'string')
    assert.ok(username)
    assert.equal(typeof username, 'string')
    let directInbox = this.#directInboxCache.get(actorId)
    if (directInbox) {
      return directInbox
    }

    const obj = await this.#client.get(actorId, username)

    if (!obj.inbox) {
      return null
    }
    const inboxes = Array.from(obj.inbox)
    if (inboxes.length === 0) {
      return null
    }
    directInbox = inboxes[0].id
    this.#directInboxCache.set(actorId, directInbox)
    return directInbox
  }

  async #strip (activity) {
    const exported = await activity.export({ useOriginalContext: true })
    delete exported.bcc
    delete exported.bto
    return await as2.import(exported)
  }

  #isLocal (id) {
    return this.#formatter.isLocal(id)
  }

  #isLocalActor (parts) {
    return parts.username && !parts.type && !parts.collection
  }

  #isLocalCollection (parts) {
    return parts.username && !parts.type && parts.collection && !parts.page
  }

  #isRemoteActor (obj) {
    return !!obj.inbox
  }

  #isRemoteCollection (obj) {
    return (Array.isArray(obj.type))
      ? obj.type.some(t => COLLECTION_TYPES.includes(t))
      : COLLECTION_TYPES.includes(obj.type)
  }
}
