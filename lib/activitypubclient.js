import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

import { TTLCache } from '@isaacs/ttlcache'
import { createSignature } from 'http-message-sig'

import as2 from './activitystreams.js'
import { SignaturePolicyStorage } from './signaturepolicystorage.js'
import { BlockedDomainError } from './errors/blockeddomainerror.js'
import { ActivityPubClientError } from './errors/activitypubclienterror.js'

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

const SIG_ERROR_STATUS = [400, 401, 403, 404, 410]

export class ActivityPubClient {
  static #githubUrl = 'https://github.com/evanp/activitypub-bot'
  static #userAgent = `activitypub.bot/${version} (${ActivityPubClient.#githubUrl})`
  static #accept =
    ['application/activity+json',
      'application/ld+json',
      'application/json'].join(',')

  static #nodeinfoTtl = 6 * 60 * 60 * 1000
  static #nodeinfoMax = 100000

  #keyStorage
  #urlFormatter
  #signer
  #digester
  #logger
  #throttler
  #cache
  #policyStorage
  #fetcher
  #domainBlocker
  #nodeinfoCache
  constructor (keyStorage, urlFormatter, signer, digester, logger, throttler, cache, policyStorage, fetcher, domainBlocker) {
    assert.strictEqual(typeof keyStorage, 'object')
    assert.strictEqual(typeof urlFormatter, 'object')
    assert.strictEqual(typeof signer, 'object')
    assert.strictEqual(typeof digester, 'object')
    assert.strictEqual(typeof logger, 'object')
    assert.strictEqual(typeof throttler, 'object')
    assert.strictEqual(typeof cache, 'object')
    assert.strictEqual(typeof policyStorage, 'object')
    assert.strictEqual(typeof fetcher, 'object')
    assert.strictEqual(typeof domainBlocker, 'object')
    this.#keyStorage = keyStorage
    this.#urlFormatter = urlFormatter
    this.#signer = signer
    this.#digester = digester
    this.#logger = logger.child({ class: this.constructor.name })
    this.#throttler = throttler
    this.#cache = cache
    this.#policyStorage = policyStorage
    this.#fetcher = fetcher
    this.#domainBlocker = domainBlocker
    this.#nodeinfoCache = new TTLCache({
      ttl: ActivityPubClient.#nodeinfoTtl,
      max: ActivityPubClient.#nodeinfoMax
    })
  }

  get allowPrivateNetworkRequests () {
    return this.#fetcher.allowPrivateNetworkRequests
  }

  async get (url, username = null) {
    assert.ok(url)
    assert.equal(typeof url, 'string')

    if (await this.#domainBlocker.isBlocked(url)) {
      throw new BlockedDomainError('Blocked domain', url, 'GET')
    }

    if (username) {
      assert.equal(typeof username, 'string')
      assert.ok(username !== '*')
      return await this.#get(url, username, true)
    } else {
      let result
      try {
        result = await this.#get(url, this.#urlFormatter.hostname, false)
      } catch (err) {
        if (err.status && SIG_ERROR_STATUS.includes(err.status)) {
          result = await this.#get(url, this.#urlFormatter.hostname, true)
        } else {
          throw err
        }
      }
      return result
    }
  }

  async getKey (url) {
    assert.ok(url)
    assert.equal(typeof url, 'string')

    if (await this.#domainBlocker.isBlocked(url)) {
      throw new BlockedDomainError('Blocked domain for key', url, 'GET')
    }

    let obj
    try {
      obj = await this.#get(url, this.#urlFormatter.hostname, false, false)
    } catch (err) {
      if (err.status && SIG_ERROR_STATUS.includes(err.status)) {
        obj = await this.#get(url, this.#urlFormatter.hostname, true, false)
      } else {
        throw err
      }
    }
    return obj
  }

  async post (url, obj, username) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.ok(username)
    assert.equal(typeof username, 'string')
    assert.ok(username !== '*')

    if (await this.#domainBlocker.isBlocked(url)) {
      throw new BlockedDomainError('Blocked domain for post', url, 'POST')
    }

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
    let policy = await this.#policyStorage.get(parsed.origin)
    if (!policy) {
      policy = await this.#guessPolicy(parsed.origin)
    }
    if (!policy || policy === SignaturePolicyStorage.RFC9421) {
      this.#logger.debug(
        { origin: parsed.origin, policy }, 'Signing with RFC9421'
      )
      lastPolicy = SignaturePolicyStorage.RFC9421
      headers = {
        ...baseHeaders,
        'content-digest': contentDigest
      }
      const sigHeaders = await this.#messageSign({ username, url, method, headers })
      Object.assign(headers, sigHeaders || {})
    } else if (policy === SignaturePolicyStorage.DRAFT_CAVAGE_12) {
      this.#logger.debug(
        { origin: parsed.origin, policy }, 'Signing with draft-cavage-12'
      )
      lastPolicy = SignaturePolicyStorage.DRAFT_CAVAGE_12
      headers = {
        ...baseHeaders,
        digest
      }
      headers.signature =
        await this.#sign({ username, url, method, headers })
    } else {
      throw new Error(`Unexpected signature policy ${policy}`)
    }
    const hostname = parsed.hostname
    this.#logger.debug({ url, hostname }, 'Waiting for throttler')
    await this.#throttler.throttle(hostname)
    this.#logger.debug({ url }, 'Fetching POST')
    let res = await this.#fetcher.fetch(url,
      {
        method,
        headers,
        body
      }
    )
    if (SIG_ERROR_STATUS.includes(res.status) &&
        lastPolicy === SignaturePolicyStorage.RFC9421) {
      const errBody = await res.text()
      this.#logger.debug(
        { url, status: res.status, body: errBody, headers: res.headers },
        'Authentication error; retrying with draft-cavage-12 signature'
      )
      lastPolicy = SignaturePolicyStorage.DRAFT_CAVAGE_12
      headers = {
        ...baseHeaders,
        digest
      }
      headers.signature =
        await this.#sign({ username, url, method, headers })
      res = await this.#fetcher.fetch(url,
        {
          method,
          headers,
          body
        }
      )
    }
    this.#logger.debug({ hostname }, 'updating throttler')
    await this.#throttler.update(hostname, res.headers)
    this.#logger.debug({ url }, 'Done fetching POST')
    if (res.status < 200 || res.status > 299) {
      const errBody = await res.text()
      this.#logger.debug(
        { url, status: res.status, body: errBody, headers: res.headers },
        'Error posting to url'
      )
      throw new ActivityPubClientError(
        res.status,
        `Could not post to ${url}`,
        { url, method, headers: res.headers, body: errBody }
      )
    }
    // Only cache draft-cavage-12 (i.e. the degraded fallback). Caching
    // rfc9421 would pin origins whose public endpoints don't actually
    // verify signatures, and block future re-probing when they upgrade.
    if (lastPolicy === SignaturePolicyStorage.DRAFT_CAVAGE_12) {
      await this.#policyStorage.set(parsed.origin, lastPolicy)
    }
  }

  async * items (id, username = this.#urlFormatter.hostname) {
    assert.ok(id)
    assert.equal(typeof id, 'string')
    assert.ok(username)
    assert.equal(typeof username, 'string')
    assert.ok(username !== '*')

    if (await this.#domainBlocker.isBlocked(id)) {
      throw new BlockedDomainError('Blocked domain for items', id, 'GET')
    }

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
        page = await this.get(page.id, username)
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
    let policy, lastPolicy
    if (sign) {
      this.#logger.debug({ url: baseUrl }, 'Signing GET request')
      policy = await this.#policyStorage.get(parsed.origin)
      if (!policy) {
        policy = await this.#guessPolicy(parsed.origin)
      }
      if (!policy || policy === SignaturePolicyStorage.RFC9421) {
        this.#logger.debug({ origin: parsed.origin, policy }, 'Signing with RFC 9421')
        lastPolicy = SignaturePolicyStorage.RFC9421
        const sigHeaders = await this.#messageSign({ username, url: baseUrl, method, headers })
        Object.assign(headers, sigHeaders || {})
      } else if (policy === SignaturePolicyStorage.DRAFT_CAVAGE_12) {
        this.#logger.debug({ origin: parsed.origin, policy }, 'Signing with draft-cavage-12')
        lastPolicy = SignaturePolicyStorage.DRAFT_CAVAGE_12
        headers.signature =
        await this.#sign({ username, url: baseUrl, method, headers })
      } else {
        throw new Error(`Unexpected signature policy ${policy}`)
      }
    }
    const hostname = parsed.hostname
    this.#logger.debug({ url: baseUrl, hostname }, 'Waiting for throttler')
    await this.#throttler.throttle(hostname)
    this.#logger.debug({ url: baseUrl }, 'Fetching with GET')
    let res = await this.#fetcher.fetch(baseUrl,
      {
        method,
        headers
      }
    )
    this.#logger.debug({ hostname, status: res.status }, 'response received')
    if (SIG_ERROR_STATUS.includes(res.status) &&
        sign &&
        lastPolicy === SignaturePolicyStorage.RFC9421) {
      const errBody = await res.text()
      this.#logger.debug(
        { url, status: res.status, body: errBody, headers: res.headers },
        'Authentication error; retrying with draft-cavage-12 signature')
      lastPolicy = SignaturePolicyStorage.DRAFT_CAVAGE_12
      delete headers['signature-input']
      headers.signature =
        await this.#sign({ username, url: baseUrl, method, headers })
      res = await this.#fetcher.fetch(baseUrl,
        {
          method,
          headers
        }
      )
    }

    await this.#throttler.update(hostname, res.headers)
    this.#logger.debug({ url }, 'Finished GET')
    if (useCache && res.status === 304) {
      this.#logger.debug({ baseUrl }, '304 Not Modified, returning cached object')
      return cached.object
    } else if (res.status < 200 || res.status > 299) {
      const errBody = await res.text()
      this.#logger.warn(
        { status: res.status, body: errBody, url: baseUrl },
        'Could not fetch url'
      )
      throw new ActivityPubClientError(
        res.status,
        `Could not fetch ${baseUrl}`,
        { url: baseUrl, method, headers: res.headers, body: errBody }
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

    // Only cache draft-cavage-12 (i.e. the degraded fallback). Caching
    // rfc9421 would pin origins whose public endpoints don't actually
    // verify signatures, and block future re-probing when they upgrade.
    if (lastPolicy === SignaturePolicyStorage.DRAFT_CAVAGE_12) {
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
    // NB: should only test for fragments,
    // but e.g. gotosocial has this.
    const resolved = (obj.id !== url)
      ? this.#resolveObject(obj, url)
      : obj
    return resolved
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
    const message = {
      kind: 'request',
      method,
      targetUri: url,
      fields: Object.entries(headers).map(([name, value]) => ({ name, value }))
    }
    const components = ['@method', '@target-uri', 'date', 'user-agent']
    if (method === 'GET') {
      components.push('accept')
    } else if (method === 'POST') {
      components.push('content-type', 'content-digest')
    }
    const { signature, signatureInput } = await createSignature(message, {
      label: 'sig1',
      components,
      parameters: {
        keyid: keyId,
        alg: 'rsa-v1_5-sha256',
        created: Math.floor(Date.now() / 1000)
      },
      signer: {
        algorithm: 'rsa-v1_5-sha256',
        async sign (data) {
          const signer = crypto.createSign('sha256')
          signer.update(data)
          const signature = signer.sign(privateKey)
          signer.end()
          return signature
        }
      }
    })

    return {
      signature,
      'signature-input': signatureInput
    }
  }

  #isCollection (obj) {
    return (Array.isArray(obj.type))
      ? obj.type.some(item => COLLECTION_TYPES.includes(item))
      : COLLECTION_TYPES.includes(obj.type)
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

  async #guessPolicy (origin) {
    const nodeinfo = await this.#getNodeinfo(origin)
    if (nodeinfo && nodeinfo.software?.name === 'pixelfed') {
      return SignaturePolicyStorage.DRAFT_CAVAGE_12
    } else {
      return null
    }
  }

  async #getNodeinfo (origin) {
    let nodeinfo
    if (this.#nodeinfoCache.has(origin)) {
      nodeinfo = this.#nodeinfoCache.get(origin)
    } else {
      nodeinfo = await this.#fetchNodeinfo(origin)
      this.#nodeinfoCache.set(origin, nodeinfo)
    }
    return nodeinfo
  }

  async #fetchNodeinfo (origin) {
    this.#logger.debug({ origin }, 'Getting /.well-known/nodeinfo')
    const url = `${origin}/.well-known/nodeinfo`
    let json
    try {
      const res = await this.#fetcher.fetch(url)
      if (!res.ok) {
        return null
      }
      json = await res.json()
    } catch (err) {
      this.#logger.debug({ origin, err }, 'Error getting /.well-known/nodeinfo')
      return null
    }
    if (!('links' in json)) {
      return null
    }
    const versions = ['2.0', '2.1', '2.2']
    const base = 'http://nodeinfo.diaspora.software/ns/schema/'
    const rels = versions.map(v => `${base}${v}`)
    const matched = json.links.find(link => rels.includes(link.rel))
    if (!matched) {
      return null
    }
    let nodeinfo
    try {
      const res = await this.#fetcher.fetch(matched.href)
      if (!res.ok) {
        return null
      }
      nodeinfo = await res.json()
    } catch (err) {
      this.#logger.debug({ href: matched.href, err }, 'Error getting nodeinfo')
      return null
    }
    return nodeinfo
  }
}
