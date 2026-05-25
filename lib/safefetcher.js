import fetch from 'node-fetch'
import dns from 'node:dns/promises'
import https from 'node:https'

import ipaddr from 'ipaddr.js'

function isPrivateIP (address) {
  if (!ipaddr.isValid(address)) return false
  const addr = ipaddr.parse(address)
  const range = addr.range()
  return range !== 'unicast'
}

class PrivateNetworkError extends Error {
  constructor (address) {
    super(`Private network address ${address}`)
    this.name = 'PrivateNetworkError'
    this.address = address
  }
}

class SafeAgent extends https.Agent {
  constructor (options = {}) {
    super({
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 64,
      maxFreeSockets: 256,
      ...options
    })
  }

  createConnection (options, callback) {
    dns.lookup(options.hostname)
      .then(({ address, family }) => {
        if (isPrivateIP(address)) {
          return callback(new PrivateNetworkError(address))
        }
        try {
          const socket = super.createConnection({
            ...options,
            host: address,
            family,
            servername: options.servername || options.hostname
          })
          callback(null, socket)
        } catch (e) {
          callback(e)
        }
      })
      .catch((err) => {
        return callback(err)
      })
  }
}

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

  constructor (options = {}) {
    const { allowPrivate } = options
    this.#allowPrivate = !!allowPrivate
    this.#agent = (this.#allowPrivate)
      ? null
      : new SafeAgent()
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
