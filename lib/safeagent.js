import https from 'node:https'
import dns from 'node:dns'

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

export class SafeAgent extends https.Agent {
  createConnection (options, callback) {
    dns.lookup(options.hostname, (err, address) => {
      if (err) {
        return callback(err)
      }
      if (isPrivateIP(address)) {
        return callback(new PrivateNetworkError(address))
      }
      super.createConnection({ ...options, hostname: address }, callback)
    })
  }
}
