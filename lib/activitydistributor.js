import assert from 'node:assert'
import as2 from './activitystreams.js'
import { LRUCache } from 'lru-cache'
import PQueue from 'p-queue'
import { setTimeout } from 'node:timers/promises'

const NS = 'https://www.w3.org/ns/activitystreams#'

const COLLECTION_TYPES = [
  `${NS}Collection`,
  `${NS}OrderedCollection`
]

export class ActivityDistributor {
  static #MAX_CACHE_SIZE = 1000000
  static #CONCURRENCY = 32
  static #MAX_ATTEMPTS = 16
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
  #queue = null
  #retryQueue = null
  #logger = null

  constructor (client, formatter, actorStorage, logger = null) {
    this.#client = client
    this.#formatter = formatter
    this.#actorStorage = actorStorage
    this.#logger = logger.child({ class: this.constructor.name })
    this.#directInboxCache = new LRUCache({ max: ActivityDistributor.#MAX_CACHE_SIZE })
    this.#sharedInboxCache = new LRUCache({ max: ActivityDistributor.#MAX_CACHE_SIZE })
    this.#queue = new PQueue({ concurrency: ActivityDistributor.#CONCURRENCY })
    this.#retryQueue = new PQueue()
  }

  async distribute (activity, username) {
    const stripped = await this.#strip(activity)
    const actorId = this.#formatter.format({ username })

    const delivered = new Set()
    const localDelivered = new Set()

    for await (const recipient of this.#public(activity, username)) {
      if (await this.#isLocal(recipient)) {
        if (recipient !== actorId && !localDelivered.has(recipient)) {
          localDelivered.add(recipient)
          this.#queue.add(() =>
            this.#deliverLocal(recipient, stripped, username))
        }
      } else {
        const inbox = await this.#getInbox(recipient, username)
        if (!inbox) {
          this.#logger.warn({ id: recipient.id }, 'No inbox')
        } else if (!delivered.has(inbox)) {
          delivered.add(inbox)
          this.#queue.add(() =>
            this.#deliver(inbox, stripped, username)
          )
        }
      }
    }

    for await (const recipient of this.#private(activity, username)) {
      if (await this.#isLocal(recipient)) {
        if (recipient !== actorId && !localDelivered.has(recipient)) {
          localDelivered.add(recipient)
          this.#queue.add(() =>
            this.#deliverLocal(recipient, stripped, username))
        }
      } else {
        const inbox = await this.#getDirectInbox(recipient, username)
        if (!inbox) {
          this.#logger.warn({ id: recipient.id }, 'No direct inbox')
        } else if (!delivered.has(inbox)) {
          delivered.add(inbox)
          this.#queue.add(() =>
            this.#deliver(inbox, stripped, username)
          )
        }
      }
    }
  }

  async onIdle () {
    await this.#retryQueue.onIdle()
    await this.#queue.onIdle()
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

  async #deliver (inbox, activity, username, attempt = 1) {
    try {
      await this.#client.post(inbox, activity, username)
      this.#logInfo(`Delivered ${activity.id} to ${inbox}`)
    } catch (error) {
      if (!error.status) {
        this.#logError(`Could not deliver ${activity.id} to ${inbox}: ${error.message}`)
        this.#logError(error.stack)
      } else if (error.status >= 300 && error.status < 400) {
        this.#logError(`Unexpected redirect code delivering ${activity.id} to ${inbox}: ${error.status} ${error.message}`)
      } else if (error.status >= 400 && error.status < 500) {
        this.#logError(`Bad request delivering ${activity.id} to ${inbox}: ${error.status} ${error.message}`)
      } else if (error.status >= 500 && error.status < 600) {
        if (attempt >= ActivityDistributor.#MAX_ATTEMPTS) {
          this.#logError(`Server error delivering ${activity.id} to ${inbox}: ${error.status} ${error.message}; giving up after ${attempt} attempts`)
        }
        const delay = Math.round((2 ** (attempt - 1) * 1000) * (0.5 + Math.random()))
        this.#logWarning(`Server error delivering ${activity.id} to ${inbox}: ${error.status} ${error.message}; will retry in ${delay} ms (${attempt} of ${ActivityDistributor.#MAX_ATTEMPTS})`)
        this.#retryQueue.add(() => setTimeout(delay).then(() => this.#deliver(inbox, activity, username, attempt + 1)))
      }
    }
  }

  #logError (message) {
    if (this.#logger) {
      this.#logger.error(message)
    }
  }

  #logWarning (message) {
    if (this.#logger) {
      this.#logger.warn(message)
    }
  }

  #logInfo (message) {
    if (this.#logger) {
      this.#logger.info(message)
    }
  }

  #isLocal (id) {
    return this.#formatter.isLocal(id)
  }

  async #deliverLocal (id, activity) {
    const username = this.#formatter.getUserName(id)
    if (username) {
      await this.#actorStorage.addToCollection(username, 'inbox', activity)
    }
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
