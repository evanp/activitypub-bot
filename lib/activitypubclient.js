import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import fetch from 'node-fetch'

import as2 from './activitystreams.js'
import { SignaturePolicyStorage } from './signaturepolicystorage.js'

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

function normalizeHeaders (headers) {
  if (!headers) {
    return headers
  }
  if (typeof headers.forEach === 'function') {
    const result = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
  return headers
}

export class ActivityPubClientError extends Error {
  constructor (status, message, { url, method, headers, body } = {}) {
    super(message)
    this.name = 'ActivityPubClientError'
    this.status = status
    this.url = url
    this.method = method
    this.headers = normalizeHeaders(headers)
    this.body = body
  }
}

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
  #messageSigner
  #policyStorage

  constructor (keyStorage, urlFormatter, signer, digester, logger, limiter, cache, messageSigner, policyStorage) {
    assert.strictEqual(typeof keyStorage, 'object')
    assert.strictEqual(typeof urlFormatter, 'object')
    assert.strictEqual(typeof signer, 'object')
    assert.strictEqual(typeof digester, 'object')
    assert.strictEqual(typeof logger, 'object')
    assert.strictEqual(typeof limiter, 'object')
    assert.strictEqual(typeof cache, 'object')
    assert.strictEqual(typeof messageSigner, 'object')
    assert.strictEqual(typeof policyStorage, 'object')
    this.#keyStorage = keyStorage
    this.#urlFormatter = urlFormatter
    this.#signer = signer
    this.#digester = digester
    this.#logger = logger.child({ class: this.constructor.name })
    this.#limiter = limiter
    this.#cache = cache
    this.#messageSigner = messageSigner
    this.#policyStorage = policyStorage
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
      obj = await this.#get(url, this.#urlFormatter.hostname, false, false)
    } catch (err) {
      if (err.status && [401, 403, 404].includes(err.status)) {
        obj = await this.#get(url, this.#urlFormatter.hostname, true, false)
      } else {
        throw err
      }
    }
    return obj
  }

  async #get (url, username = this.#urlFormatter.hostname, sign = false, useCache = true) {
    const json = await this.#getJSON(url, username, sign, useCache)
    const obj = await this.#getObj(url, json)
    return obj
  }

  async #getJSON (url, username = this.#urlFormatter.hostname, sign = false, useCache = true) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    assert.ok(username)
    assert.equal(typeof username, 'string')

    const parsed = new URL(url)
    const baseUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`
    let cached

    if (useCache) {
      cached = await this.#cache.get(baseUrl, username)
      this.#logger.debug({ baseUrl, username, cached: !!cached, expiry: cached?.expiry }, 'cache lookup')

      if (cached) {
        this.#logger.debug({ baseUrl }, 'cache hit')
        const now = Date.now()
        const expiry = cached.expiry.getTime()
        if (expiry > now) {
          this.#logger.debug({ baseUrl, expiry, now }, 'cache fresh, returning cached object')
          return cached.object
        } else {
          this.#logger.debug({ baseUrl, expiry, now }, 'cache stale, revalidating')
        }
      }
    }

    const date = new Date().toUTCString()
    const headers = {
      accept: ActivityPubClient.#accept,
      date,
      'user-agent': ActivityPubClient.#userAgent
    }
    if (cached?.lastModified) {
      headers['if-modified-since'] = cached.lastModified.toUTCString()
    }
    if (cached?.etag) {
      headers['if-none-match'] = cached.etag
    }
    this.#logger.debug({ headers }, 'Sending headers')
    const method = 'GET'
    let storedPolicy, lastPolicy
    if (sign) {
      this.#logger.debug({ url: baseUrl }, 'Signing GET request')
      storedPolicy = await this.#policyStorage.get(parsed.origin)
      if (!storedPolicy || storedPolicy === SignaturePolicyStorage.RFC9421) {
        this.#logger.debug({ origin: parsed.origin, storedPolicy }, 'Signing with RFC 9421')
        lastPolicy = SignaturePolicyStorage.RFC9421
        const sigHeaders = await this.#messageSign({ username, url: baseUrl, method, headers })
        Object.assign(headers, sigHeaders || {})
      } else if (storedPolicy === SignaturePolicyStorage.DRAFT_CAVAGE_12) {
        this.#logger.debug({ origin: parsed.origin, storedPolicy }, 'Signing with draft-cavage-12')
        lastPolicy = SignaturePolicyStorage.DRAFT_CAVAGE_12
        headers.signature =
        await this.#sign({ username, url: baseUrl, method, headers })
      } else {
        throw new Error(`Unexpected signature policy ${storedPolicy}`)
      }
    }
    const hostname = parsed.hostname
    this.#logger.debug({ url: baseUrl, hostname }, 'Waiting for rate limiter')
    await this.#limiter.limit(hostname)
    this.#logger.debug({ url: baseUrl }, 'Fetching with GET')
    let res = await fetch(baseUrl,
      {
        method,
        headers
      }
    )
    this.#logger.debug({ hostname, status: res.status }, 'response received')
    if ([401, 403].includes(res.status) &&
        sign &&
        !storedPolicy) {
      const body = await res.text()
      this.#logger.debug(
        { url, status: res.status, body, headers: res.headers },
        'Authentication error; retrying with draft-cavage-12 signature')
      lastPolicy = SignaturePolicyStorage.DRAFT_CAVAGE_12
      delete headers['signature-input']
      headers.signature =
        await this.#sign({ username, url: baseUrl, method, headers })
      res = await fetch(baseUrl,
        {
          method,
          headers
        }
      )
    }

    await this.#limiter.update(hostname, res.headers)
    this.#logger.debug({ url }, 'Finished GET')
    if (useCache && res.status === 304) {
      this.#logger.debug({ baseUrl }, '304 Not Modified, returning cached object')
      return cached.object
    } else if (res.status < 200 || res.status > 299) {
      const body = await res.text()
      this.#logger.warn(
        { status: res.status, body, url: baseUrl },
        'Could not fetch url'
      )
      throw new ActivityPubClientError(
        res.status,
        `Could not fetch ${baseUrl}`,
        { url: baseUrl, method, headers: res.headers, body }
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

    if (sign && !storedPolicy && lastPolicy) {
      await this.#policyStorage.set(parsed.origin, lastPolicy)
    }

    await this.#cache.set(baseUrl, username, json, res.headers)

    return json
  }

  async #getObj (url, json) {
    const parsed = new URL(url)
    const baseUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`

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
    const parsed = (new URL(url))
    const json = await obj.export()
    this.#fixupJson(json)
    const body = JSON.stringify(json)
    const digest = await this.#digester.digest(body)
    const contentDigest = await this.#digester.contentDigest(body)
    const baseHeaders = {
      date: new Date().toUTCString(),
      'user-agent': ActivityPubClient.#userAgent,
      'content-type': 'application/activity+json'
    }
    const method = 'POST'
    let headers
    this.#logger.debug({ url }, 'Signing POST')
    let lastPolicy
    const storedPolicy = await this.#policyStorage.get(parsed.origin)
    if (!storedPolicy || storedPolicy === SignaturePolicyStorage.RFC9421) {
      this.#logger.debug(
        { origin: parsed.origin, storedPolicy }, 'Signing with RFC9421'
      )
      lastPolicy = SignaturePolicyStorage.RFC9421
      headers = {
        ...baseHeaders,
        'content-digest': contentDigest
      }
      const sigHeaders = await this.#messageSign({ username, url, method, headers })
      Object.assign(headers, sigHeaders || {})
    } else if (storedPolicy === SignaturePolicyStorage.DRAFT_CAVAGE_12) {
      this.#logger.debug(
        { origin: parsed.origin, storedPolicy }, 'Signing with draft-cavage-12'
      )
      lastPolicy = SignaturePolicyStorage.DRAFT_CAVAGE_12
      headers = {
        ...baseHeaders,
        digest
      }
      headers.signature =
        await this.#sign({ username, url, method, headers })
    } else {
      throw new Error(`Unexpected signature policy ${storedPolicy}`)
    }
    const hostname = parsed.hostname
    this.#logger.debug({ url, hostname }, 'Waiting for rate limiter')
    await this.#limiter.limit(hostname)
    this.#logger.debug({ url }, 'Fetching POST')
    let res = await fetch(url,
      {
        method,
        headers,
        body
      }
    )
    if ([401, 403].includes(res.status) && !storedPolicy) {
      const body = await res.text()
      this.#logger.debug(
        { url, status: res.status, body, headers: res.headers },
        'Authentication error; retrying with draft-cavage-12 signature'
      )
      lastPolicy = SignaturePolicyStorage.DRAFT_CAVAGE_12
      headers = {
        ...baseHeaders,
        digest
      }
      headers.signature =
        await this.#sign({ username, url, method, headers })
      res = await fetch(url,
        {
          method,
          headers,
          body
        }
      )
    }
    this.#logger.debug({ hostname }, 'updating limiter')
    await this.#limiter.update(hostname, res.headers)
    this.#logger.debug({ url }, 'Done fetching POST')
    if (res.status < 200 || res.status > 299) {
      const body = await res.text()
      this.#logger.debug(
        { url, status: res.status, body, headers: res.headers },
        'Error posting to url'
      )
      throw new ActivityPubClientError(
        res.status,
        `Could not post to ${url}`,
        { url, method, headers: res.headers, body }
      )
    }
    if (!storedPolicy && lastPolicy) {
      await this.#policyStorage.set(parsed.origin, lastPolicy)
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

  async #messageSign ({ username, url, method, headers }) {
    assert.ok(url)
    assert.ok(method)
    assert.ok(headers)
    assert.ok(username)
    const privateKey = await this.#keyStorage.getPrivateKey(username)
    const keyId = this.#urlFormatter.format({ username, type: 'publickey' })
    return this.#messageSigner.sign({ privateKey, keyId, url, method, headers })
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

    this.#logger.debug({ id }, 'Got object')

    if (!this.#isCollection(coll)) {
      throw new Error(`Can only iterate over a collection: ${id}`)
    }

    const items = (coll.items) ? coll.items : coll.orderedItems

    if (items) {
      for (const item of items) {
        this.#logger.debug({ id: item.id }, 'Yielding item')
        yield item
      }
    } else if (coll.first) {
      for (let page = coll.first; page; page = page.next) {
        this.#logger.debug({ id: page.id }, 'Getting page')
        page = await this.get(page.id)
        const items = (page.items) ? page.items : page.orderedItems
        if (items) {
          for (const item of items) {
            this.#logger.debug({ id: item.id }, 'Yielding item')
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

  #resolveObject (obj, url) {
    const objects = this.#resolveAllObjects(obj, url)
    assert.ok(objects)
    switch (objects.length) {
      case 0:
        return null
      case 1:
        return objects[0]
      default: {
        // hack to prefer `CryptographicKey` if available
        const key = objects.find(
          obj => obj.type === 'https://w3id.org/security#Key'
        )
        return (key) || objects[0]
      }
    }
  }

  #resolveAllObjects (obj, url, visited = new Set(), results = []) {
    if (obj.id && obj.id === url) {
      results.push(obj)
    }

    if (obj.id) {
      if (visited.has(obj.id)) {
        return results
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
          this.#resolveAllObjects(item, url, visited, results)
        }
      }
    }
    return results
  }
}
