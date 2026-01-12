import * as ttlcachePkg from '@isaacs/ttlcache'

const TTLCache =
  ttlcachePkg.TTLCache ?? ttlcachePkg.default ?? ttlcachePkg

export class ObjectCache {
  #objects = null
  #members = null
  constructor ({ longTTL, shortTTL, maxItems }) {
    this.#objects = new TTLCache({ ttl: shortTTL, max: maxItems })
    this.#members = new TTLCache({ ttl: shortTTL, max: maxItems })
    this.longTTL = longTTL
    this.shortTTL = shortTTL
    this.maxItems = maxItems
  }

  async initialize () {
  }

  async get (id) {
    return this.#objects.get(id)
  }

  async save (object) {
    return this.#objects.set(object.id, object, { ttl: this.longTTL })
  }

  async saveReceived (object) {
    return this.#objects.set(object.id, object, { ttl: this.shortTTL })
  }

  async clear (object) {
    return this.#objects.delete(object.id)
  }

  membershipKey (collection, object) {
    return `${collection.id}:${object.id}`
  }

  async saveMembership (collection, object, isMember = true) {
    return this.#members.set(this.membershipKey(collection, object), isMember, { ttl: this.longTTL })
  }

  async saveMembershipReceived (collection, object, isMember = true) {
    return this.#members.set(this.membershipKey(collection, object), isMember, { ttl: this.shortTTL })
  }

  async isMember (collection, object) {
    return this.#members.get(this.membershipKey(collection, object))
  }
}
