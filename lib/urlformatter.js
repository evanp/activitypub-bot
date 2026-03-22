import assert from 'assert'

const USER_COLLECTIONS = ['inbox', 'outbox', 'liked', 'followers', 'following']

export class UrlFormatter {
  #origin = null
  #hostname

  constructor (origin) {
    this.#origin = origin
    this.#hostname = (new URL(origin)).hostname
  }

  format ({ username, type, nanoid, collection, page, server }) {
    let base = null
    if (server) {
      return this.format({ username: this.#hostname, type, nanoid, collection, page, server: false })
    } else if (username) {
      base = `${this.#origin}/user/${username}`
    } else {
      throw new Error('Cannot format URL without username or server')
    }
    let major = null
    if (type) {
      if (nanoid) {
        major = `${base}/${type.toLowerCase()}/${nanoid}`
      } else if (type === 'publickey') {
        major = `${base}/${type.toLowerCase()}`
      } else {
        throw new Error('Cannot format URL without nanoid')
      }
    } else {
      major = base
    }
    let url = null
    if (collection) {
      if (page) {
        url = `${major}/${collection}/${page}`
      } else {
        url = `${major}/${collection}`
      }
    } else {
      url = major
    }
    // For the base case, we want a trailing slash.
    if (url === this.#origin) {
      url = `${url}/actor`
    }
    return url
  }

  isLocal (url) {
    assert.equal(typeof url, 'string', 'url must be a string')
    return url.startsWith(this.#origin)
  }

  getUserName (url) {
    assert.equal(typeof url, 'string', 'url must be a string')
    const parts = this.unformat(url)
    return parts.username
  }

  unformat (url) {
    assert.equal(typeof url, 'string', 'url must be a string')
    const parts = {}
    const parsed = new URL(url)
    if (parsed.origin !== this.#origin) {
      throw new Error(`Can't unformat URL from remote server ${parsed.origin}`)
    }
    let pathParts = parsed.pathname.slice(1).split('/')
    if (pathParts.length > 0 && pathParts[0] === 'user') {
      parts.username = pathParts[1]
      pathParts = pathParts.slice(2)
      parts.server = (parts.username === this.#hostname)
    }
    if (pathParts.length > 0) {
      if (USER_COLLECTIONS.includes(pathParts[0])) {
        parts.collection = pathParts[0]
      } else {
        parts.type = pathParts[0]
      }
    }
    if (pathParts.length > 1) {
      if (USER_COLLECTIONS.includes(pathParts[0])) {
        parts.page = parseInt(pathParts[1])
      } else {
        parts.nanoid = pathParts[1]
      }
    }
    if (pathParts.length > 2) {
      parts.collection = pathParts[2]
    }
    if (pathParts.length > 3) {
      parts.page = parseInt(pathParts[3])
    }
    return parts
  }

  isActor (url) {
    if (!this.isLocal(url)) {
      return false
    }
    const parts = this.unformat(url)
    return (parts.username && !parts.type && !parts.collection)
  }

  acct (username = null) {
    return (username)
      ? `acct:${username}@${this.#hostname}`
      : `acct:${this.#hostname}@${this.#hostname}`
  }
}
