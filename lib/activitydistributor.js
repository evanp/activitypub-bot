import assert from 'node:assert'
import as2 from 'activitystrea.ms'
import { LRUCache } from 'lru-cache'
import PQueue from 'p-queue'
import { setTimeout } from 'node:timers/promises'

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
    this.#logger = logger
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
        if (!delivered.has(inbox)) {
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
        if (!delivered.has(inbox)) {
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
    const followers = this.#formatter.format({
      username,
      collection: 'followers'
    })
    for (const prop of ['to', 'cc', 'audience']) {
      const p = activity.get(prop)
      if (p) {
        for (const value of p) {
          const id = value.id
          if (id === followers ||
            ActivityDistributor.#PUBLIC.includes(id)) {
            for await (const follower of this.#actorStorage.items(username, 'followers')) {
              yield follower.id
            }
          } else {
            yield id
          }
        }
      }
    }
  }

  async * #private (activity, username) {
    const followers = this.#formatter.format({
      username,
      collection: 'followers'
    })
    for (const prop of ['bto', 'bcc']) {
      const p = activity.get(prop)
      if (p) {
        for (const value of p) {
          const id = value.id
          if (id === followers ||
            ActivityDistributor.#PUBLIC.includes(id)) {
            for await (const follower of this.#actorStorage.items(username, 'followers')) {
              yield follower.id
            }
          } else {
            yield id
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
      throw new Error(`no inbox for actor ${actorId}`)
    }
    const inboxes = Array.from(obj.inbox)
    if (inboxes.length === 0) {
      throw new Error('no inbox')
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
      throw new Error(`no inbox for actor ${actorId}`)
    }
    const inboxes = Array.from(obj.inbox)
    if (inboxes.length === 0) {
      throw new Error('no inbox')
    }
    directInbox = inboxes[0].id
    this.#directInboxCache.set(actorId, directInbox)
    return directInbox
  }

  async #strip (activity) {
    const exported = await activity.export()
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
}
