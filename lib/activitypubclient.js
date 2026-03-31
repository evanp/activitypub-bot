import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import fetch from 'node-fetch'
import createHttpError from 'http-errors'

import as2 from './activitystreams.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const { version } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
)

const NS = 'https://www.w3.org/ns/activitystreams#'

const COLLECTION_TYPES = [
  `${NS}Collection`,
  `${NS}OrderedCollection`
]

export class ActivityPubClient {
  static #githubUrl = 'https://github.com/evanp/activitypub-bot'
  static #userAgent = `activitypub.bot/${version} (${ActivityPubClient.#githubUrl})`
  static #accept =
    ['application/activity+json',
      'application/ld+json',
      'application/json'].join(',')

  #keyStorage = null
  #urlFormatter = null
  #signer = null
  #digester = null
  #logger = null
  #limiter
  #cache

  constructor (keyStorage, urlFormatter, signer, digester, logger, limiter, cache) {
    assert.strictEqual(typeof keyStorage, 'object')
    assert.strictEqual(typeof urlFormatter, 'object')
    assert.strictEqual(typeof signer, 'object')
    assert.strictEqual(typeof digester, 'object')
    assert.strictEqual(typeof logger, 'object')
    assert.strictEqual(typeof limiter, 'object')
    this.#keyStorage = keyStorage
    this.#urlFormatter = urlFormatter
    this.#signer = signer
    this.#digester = digester
    this.#logger = logger.child({ class: this.constructor.name })
    this.#limiter = limiter
    this.#cache = cache
  }

  async get (url, username = this.#urlFormatter.hostname) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    assert.ok(username)
    assert.equal(typeof username, 'string')
    assert.ok(username !== '*')

    return await this.#get(url, username, true)
  }

  async getKey (url) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    let obj
    try {
      obj = await this.#get(url, this.#urlFormatter.hostname, false)
    } catch (err) {
      if (err.status && [401, 403, 404].includes(err.status)) {
        obj = await this.#get(url, this.#urlFormatter.hostname, true)
      } else {
        throw err
      }
    }
    return obj
  }

  async #get (url, username = this.#urlFormatter.hostname, sign = false) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    assert.ok(username)
    assert.equal(typeof username, 'string')

    const parsed = new URL(url)
    const baseUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`

    const cached = await this.#cacheGet(baseUrl, username)

    if (cached && cached.expiry > (new Date())) {
      const base = await as2.import(cached.object)
      const resolved = (parsed.hash)
        ? this.#resolveObject(base, url)
        : base
      return resolved
    }

    const date = new Date().toUTCString()
    const headers = {
      accept: ActivityPubClient.#accept,
      date,
      'user-agent': ActivityPubClient.#userAgent,
      'if-modified-since': cached?.lastModified?.toUTCString(),
      'if-none-match': cached?.etag
    }
    const method = 'GET'
    this.#logger.debug(`Signing GET request for ${baseUrl}`)
    if (sign) {
      headers.signature =
        await this.#sign({ username, url: baseUrl, method, headers })
    }
    const hostname = parsed.hostname
    this.#logger.debug({ url: baseUrl, hostname }, 'Waiting for rate limiter')
    await this.#limiter.limit(hostname)
    this.#logger.debug(`Fetching ${baseUrl} with GET`)
    const res = await fetch(baseUrl,
      {
        method,
        headers
      }
    )
    this.#logger.debug({ hostname }, 'updating limiter')
    await this.#limiter.update(hostname, res.headers)
    this.#logger.debug(`Finished getting ${url}`)
    if (res.status === 304) {
      const base = await as2.import(cached.object)
      const resolved = (parsed.hash)
        ? this.#resolveObject(base, url)
        : base
      return resolved
    } else if (res.status < 200 || res.status > 299) {
      const body = await res.text()
      this.#logger.warn(
        { status: res.status, body, url: baseUrl },
        'Could not fetch url'
      )
      throw createHttpError(
        res.status,
        `Could not fetch ${baseUrl}`,
        { headers: res.headers }
      )
    }

    const contentType = res.headers.get('content-type')
    const mimeType = contentType?.split(';')[0].trim()
    if (mimeType !== 'application/json' && !mimeType.endsWith('+json')) {
      this.#logger.warn({ mimeType, url: baseUrl }, 'Unexpected mime type')
      throw new Error(`Got unexpected mime type ${mimeType} for URL ${url}`)
    }
    let json
    try {
      json = await res.json()
    } catch (err) {
      this.#logger.warn({ url: baseUrl }, 'Error parsing fetch results')
      throw err
    }

    await this.#cacheSet(baseUrl, username, json, res.headers)

    let obj
    try {
      obj = await as2.import(json)
    } catch (err) {
      this.#logger.warn({ url: baseUrl, json }, 'Error importing JSON as AS2')
      throw err
    }
    const resolved = (parsed.hash)
      ? this.#resolveObject(obj, url)
      : obj
    return resolved
  }

  async post (url, obj, username) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.ok(username)
    assert.equal(typeof username, 'string')
    assert.ok(username !== '*')
    const json = await obj.export()
    this.#fixupJson(json)
    const body = JSON.stringify(json)
    const headers = {
      date: new Date().toUTCString(),
      'user-agent': ActivityPubClient.#userAgent,
      'content-type': 'application/activity+json',
      digest: await this.#digester.digest(body)
    }
    const method = 'POST'
    assert.ok(headers)
    this.#logger.debug(`Signing POST for ${url}`)
    headers.signature = await this.#sign({ username, url, method, headers })
    const hostname = (new URL(url)).hostname
    this.#logger.debug({ url, hostname }, 'Waiting for rate limiter')
    await this.#limiter.limit(hostname)
    this.#logger.debug(`Fetching POST for ${url}`)
    const res = await fetch(url,
      {
        method,
        headers,
        body
      }
    )
    this.#logger.debug({ hostname }, 'updating limiter')
    await this.#limiter.update(hostname, res.headers)
    this.#logger.debug(`Done fetching POST for ${url}`)
    if (res.status < 200 || res.status > 299) {
      throw createHttpError(
        res.status,
        await res.text(),
        { headers: res.headers }
      )
    }
  }

  async #sign ({ username, url, method, headers }) {
    assert.ok(url)
    assert.ok(method)
    assert.ok(headers)
    assert.ok(username)
    const privateKey = await this.#keyStorage.getPrivateKey(username)
    const keyId = this.#urlFormatter.format({ username, type: 'publickey' })
    return this.#signer.sign({ privateKey, keyId, url, method, headers })
  }

  #isCollection (obj) {
    return (Array.isArray(obj.type))
      ? obj.type.some(item => COLLECTION_TYPES.includes(item))
      : COLLECTION_TYPES.includes(obj.type)
  }

  async * items (id, username = this.#urlFormatter.hostname) {
    assert.ok(id)
    assert.equal(typeof id, 'string')
    assert.ok(username)
    assert.equal(typeof username, 'string')
    assert.ok(username !== '*')

    const coll = await this.get(id, username)

    this.#logger.debug(`Got object ${id}`)

    if (!this.#isCollection(coll)) {
      throw new Error(`Can only iterate over a collection: ${id}`)
    }

    const items = (coll.items) ? coll.items : coll.orderedItems

    if (items) {
      for (const item of items) {
        this.#logger.debug(`Yielding ${item.id}`)
        yield item
      }
    } else if (coll.first) {
      for (let page = coll.first; page; page = page.next) {
        this.#logger.debug(`Getting page ${page.id}`)
        page = await this.get(page.id)
        const items = (page.items) ? page.items : page.orderedItems
        if (items) {
          for (const item of items) {
            this.#logger.debug(`Yielding ${item.id}`)
            yield item
          }
        }
      }
    }
  }

  #fixupJson (json) {
    this.#fixupRelayFollow(json)
    this.#fixupRelayUndoFollow(json)
  }

  #fixupRelayFollow (json) {
    if (typeof json.type === 'string' &&
      json.type === 'Follow' &&
      typeof json.object === 'string' &&
      json.object === 'as:Public') {
      json.object = 'https://www.w3.org/ns/activitystreams#Public'
    }
  }

  #fixupRelayUndoFollow (json) {
    if (typeof json.type === 'string' &&
      json.type === 'Undo' &&
      typeof json.object === 'object' &&
      typeof json.object.type === 'string' &&
      json.object.type === 'Follow' &&
      typeof json.object.object === 'string' &&
      json.object.object === 'as:Public') {
      json.object.object = 'https://www.w3.org/ns/activitystreams#Public'
    }
  }

  #resolveObject (obj, url, visited = new Set()) {
    if (obj.id && obj.id === url) {
      return obj
    }

    if (obj.id) {
      if (visited.has(obj.id)) {
        return null
      }
      visited.add(obj.id)
    }

    for (const key of obj) {
      if (key === '@type' || key === '@id') continue

      const val = obj.get(key)

      if (val == null || typeof val[Symbol.iterator] !== 'function') {
        continue
      }

      for (const item of val) {
        if (item instanceof as2.models.Base) {
          const found = this.#resolveObject(item, url, visited)
          if (found) {
            return found
          }
        }
      }
    }
    return null
  }

  async #cacheGet (id, username) {
    return (this.#cache)
      ? await this.#cache.get(id, username)
      : null
  }

  async #cacheSet (id, username, object, headers) {
    if (this.#cache) {
      await this.#cache.set(id, username, object, headers)
    }
  }
}
