import as2 from 'activitystrea.ms'
import fetch from 'node-fetch'
import crypto from 'node:crypto'
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

  constructor (keyStorage, urlFormatter) {
    this.#keyStorage = keyStorage
    this.#urlFormatter = urlFormatter
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
    if (sign) {
      headers.signature =
        await this.#sign({ username, url, method: 'GET', date })
    }
    return await fetch(url,
      {
        method: 'GET',
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
    const date = new Date().toUTCString()
    const body = await obj.write()
    const digest = this.#digest(body)
    const signature = await this.#sign({ username, url, method: 'GET', date, digest })
    const res = await fetch(url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/activity+json',
          date,
          signature,
          digest,
          'user-agent': ActivityPubClient.#userAgent
        },
        body
      }
    )
    if (res.status < 200 || res.status > 299) {
      throw createHttpError(res.status, `Could not deliver ${obj.id} to ${url}`)
    }
  }

  async #sign ({ username, url, method, date, digest }) {
    const privateKey = await this.#keyStorage.getPrivateKey(username)
    const keyId = (username)
      ? this.#urlFormatter.format({ username, type: 'publickey' })
      : this.#urlFormatter.format({ server: true, type: 'publickey' })
    const parsed = new URL(url)
    const target = (parsed.search && parsed.search.length)
      ? `${parsed.pathname}?${parsed.search}`
      : `${parsed.pathname}`
    let data = `(request-target): ${method.toLowerCase()} ${target}\n`
    data += `host: ${parsed.host}\n`
    data += `date: ${date}`
    if (digest) {
      data += `\ndigest: ${digest}`
    }
    const signer = crypto.createSign('sha256')
    signer.update(data)
    const signature = signer.sign(privateKey).toString('base64')
    signer.end()
    return `keyId="${keyId}",headers="(request-target) host date${(digest) ? ' digest' : ''}",signature="${signature.replace(/"/g, '\\"')}",algorithm="rsa-sha256"`
  }

  async #digest (body) {
    const digest = crypto.createHash('sha256')
    digest.update(body)
    return `SHA-256=${digest.digest('base64')}`
  }
}
