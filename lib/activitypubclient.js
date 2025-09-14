import as2 from './activitystreams.js'
import fetch from 'node-fetch'
import assert from 'node:assert'
import createHttpError from 'http-errors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const { version } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
)

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

  constructor (keyStorage, urlFormatter, signer, digester, logger) {
    this.#keyStorage = keyStorage
    this.#urlFormatter = urlFormatter
    this.#signer = signer
    this.#digester = digester
    this.#logger = logger.child({ class: this.constructor.name })
  }

  async get (url, username = null) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    const res = await this.#getRes(url, username, true)
    return await this.#handleRes(res, url)
  }

  async getKey (url) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    let res = await this.#getRes(url, null, false)
    if ([401, 403, 404].includes(res.status)) {
      // If we get a 401, 403, or 404, we should try again with the key
      res = await this.#getRes(url, null, true)
    }
    return await this.#handleRes(res, url)
  }

  async #getRes (url, username = null, sign = false) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    const date = new Date().toUTCString()
    const headers = {
      accept: ActivityPubClient.#accept,
      date,
      'user-agent': ActivityPubClient.#userAgent
    }
    const method = 'GET'
    if (sign) {
      headers.signature =
        await this.#sign({ username, url, method, headers })
    }
    return await fetch(url,
      {
        method,
        headers
      }
    )
  }

  async #handleRes (res, url) {
    if (res.status < 200 || res.status > 299) {
      throw createHttpError(res.status, `Could not fetch ${url}`)
    }
    const json = await res.json()
    const obj = await as2.import(json)
    return obj
  }

  async post (url, obj, username) {
    assert.ok(url)
    assert.equal(typeof url, 'string')
    assert.ok(obj)
    assert.equal(typeof obj, 'object')
    assert.ok(username)
    assert.equal(typeof username, 'string')
    const body = await obj.write()
    const headers = {
      date: new Date().toUTCString(),
      'user-agent': ActivityPubClient.#userAgent,
      'content-type': 'application/activity+json',
      digest: await this.#digester.digest(body)
    }
    const method = 'POST'
    assert.ok(headers)
    headers.signature = await this.#sign({ username, url, method, headers })
    const res = await fetch(url,
      {
        method,
        headers,
        body
      }
    )
    if (res.status < 200 || res.status > 299) {
      throw createHttpError(res.status, await res.text())
    }
  }

  async #sign ({ username, url, method, headers }) {
    assert.ok(url)
    assert.ok(method)
    assert.ok(headers)
    const privateKey = await this.#keyStorage.getPrivateKey(username)
    const keyId = (username)
      ? this.#urlFormatter.format({ username, type: 'publickey' })
      : this.#urlFormatter.format({ server: true, type: 'publickey' })
    return this.#signer.sign({ privateKey, keyId, url, method, headers })
  }
}
