import fetch from 'node-fetch'
import ipaddr from 'ipaddr.js'
import dns from 'node:dns/promises'

export class ProtocolError extends Error {
  constructor (url) {
    super(`URL ${url} uses a disallowed protocol`)
    this.name = 'ProtocolError'
    this.url = url
  }
}

export class SafeFetcher {
  #allowPrivate
  #agent

  constructor (agent, options = {}) {
    const { allowPrivate } = options
    this.#allowPrivate = !!allowPrivate
    this.#agent = (this.#allowPrivate)
      ? null
      : agent
  }

  get allowPrivateNetworkRequests () {
    return this.#allowPrivate
  }

  async fetch (url, options) {
    if (!(await this.#checkProtocol(url))) {
      throw new ProtocolError(url)
    }
    const fullOptions = {
      ...options,
      agent: this.#agent ?? undefined,
      signal: options?.signal ?? AbortSignal.timeout(10000),
      size: 1024 * 1024,
      follow: 10
    }
    return await fetch(url, fullOptions)
  }

  async #checkProtocol (url) {
    const parsed = (new URL(url))
    switch (parsed.protocol) {
      case 'https:':
        return true
      case 'http:': {
        if (this.#agent) {
          return false
        }
        const { address } = await dns.lookup(parsed.hostname)
        const addr = ipaddr.parse(address)
        const range = addr.range()
        return range !== 'unicast'
      }
      default:
        return false
    }
  }
}
