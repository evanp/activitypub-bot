import { describe, it } from 'node:test'
import assert from 'node:assert'
import { UrlFormatter } from '../lib/urlformatter.js'

describe('UrlFormatter', () => {
  const hostname = 'local.urlformatter.test'
  const origin = `https://${hostname}`
  let formatter = null
  it('can initialize', () => {
    formatter = new UrlFormatter(origin)
  })
  it('can format a user URL', () => {
    const url = formatter.format({ username: 'megabot' })
    assert.equal(url, `${origin}/user/megabot`)
  })
  it('can format a public key URL', () => {
    const url = formatter.format({ username: 'megabot', type: 'publickey' })
    assert.equal(url, `${origin}/user/megabot/publickey`)
  })
  it('can format an inbox URL', () => {
    const url = formatter.format({ username: 'megabot', collection: 'inbox' })
    assert.equal(url, `${origin}/user/megabot/inbox`)
  })
  it('can format an inbox URL page', () => {
    const url = formatter.format({
      username: 'megabot',
      collection: 'inbox',
      page: 3
    })
    assert.equal(url, `${origin}/user/megabot/inbox/3`)
  })
  it('can format an activity URL', () => {
    const url = formatter.format({
      username: 'megabot',
      type: 'like',
      nanoid: 'LNPUlv9kmvhAdr4eoqkil'
    })
    assert.equal(url, `${origin}/user/megabot/like/LNPUlv9kmvhAdr4eoqkil`)
  })
  it('can format a note URL', () => {
    const url = formatter.format({
      username: 'megabot',
      type: 'note',
      nanoid: 'LNPUlv9kmvhAdr4eoqkil'
    })
    assert.equal(url, `${origin}/user/megabot/note/LNPUlv9kmvhAdr4eoqkil`)
  })
  it('can format a note replies URL', () => {
    const url = formatter.format({
      username: 'megabot',
      type: 'note',
      nanoid: 'LNPUlv9kmvhAdr4eoqkil',
      collection: 'replies'
    })
    assert.equal(url, `${origin}/user/megabot/note/LNPUlv9kmvhAdr4eoqkil/replies`)
  })
  it('can format a note replies page URL', () => {
    const url = formatter.format({
      username: 'megabot',
      type: 'note',
      nanoid: 'LNPUlv9kmvhAdr4eoqkil',
      collection: 'replies',
      page: 4
    })
    assert.equal(url, `${origin}/user/megabot/note/LNPUlv9kmvhAdr4eoqkil/replies/4`)
  })
  it('can format a server URL', () => {
    const url = formatter.format({
      server: true
    })
    assert.equal(url, `${origin}/user/${hostname}`)
  })
  it('can format a server public key URL', () => {
    const url = formatter.format({
      server: true,
      type: 'publickey'
    })
    assert.equal(url, `${origin}/user/${hostname}/publickey`)
  })
  it('can tell if an URL is local', () => {
    assert.ok(formatter.isLocal(`${origin}/user/megabot`))
    assert.ok(!formatter.isLocal('https://social.urlformatter.test/user/megabot'))
  })
  it('can get a username from a user URL', () => {
    const username = formatter.getUserName(`${origin}/user/megabot`)
    assert.equal(username, 'megabot')
  })
  it('refuses to unformat a remote URL', () => {
    assert.throws(() => formatter.unformat(
      'https://remote.urlformatter.test/some/unrelated/33/path/format'
    ))
  })
  it('can unformat a user URL', () => {
    const parts = formatter.unformat(
      `${origin}/user/megabot`
    )
    assert.equal(parts.username, 'megabot')
  })
  it('can unformat a public key URL', () => {
    const parts = formatter.unformat(
      `${origin}/user/megabot/publickey`
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'publickey')
  })
  it('can unformat an inbox URL', () => {
    const parts = formatter.unformat(
      `${origin}/user/megabot/inbox`
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.collection, 'inbox')
  })
  it('can unformat an inbox page URL', () => {
    const parts = formatter.unformat(
      `${origin}/user/megabot/inbox/3`
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.collection, 'inbox')
    assert.equal(parts.page, 3)
  })
  it('can unformat an activity URL', () => {
    const parts = formatter.unformat(
      `${origin}/user/megabot/like/LNPUlv9kmvhAdr4eoqkil`
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'like')
    assert.equal(parts.nanoid, 'LNPUlv9kmvhAdr4eoqkil')
  })
  it('can unformat a note URL', () => {
    const parts = formatter.unformat(
      `${origin}/user/megabot/note/LNPUlv9kmvhAdr4eoqkil`
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'note')
    assert.equal(parts.nanoid, 'LNPUlv9kmvhAdr4eoqkil')
  })
  it('can unformat a note replies URL', () => {
    const parts = formatter.unformat(
      `${origin}/user/megabot/note/LNPUlv9kmvhAdr4eoqkil/replies`
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'note')
    assert.equal(parts.nanoid, 'LNPUlv9kmvhAdr4eoqkil')
    assert.equal(parts.collection, 'replies')
  })
  it('can unformat a note replies page URL', () => {
    const parts = formatter.unformat(
      `${origin}/user/megabot/note/LNPUlv9kmvhAdr4eoqkil/replies/4`
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'note')
    assert.equal(parts.nanoid, 'LNPUlv9kmvhAdr4eoqkil')
    assert.equal(parts.collection, 'replies')
    assert.equal(parts.page, 4)
  })
  it('can unformat a server URL', () => {
    const parts = formatter.unformat(`${origin}/user/${hostname}`)
    assert.ok(parts.server)
    assert.ok(!parts.type)
  })
  it('can unformat a server public key URL', () => {
    const parts = formatter.unformat(`${origin}/user/${hostname}/publickey`)
    assert.ok(parts.server)
    assert.equal(parts.type, 'publickey')
  })
  it('can format a bot acct: URI', () => {
    const username = 'test13'
    const uri = formatter.acct(username)
    assert.strictEqual(uri, `acct:${username}@${hostname}`)
  })
  it('can format a server acct: URI', () => {
    const uri = formatter.acct()
    assert.strictEqual(uri, `acct:${hostname}@${hostname}`)
  })
  it('can return its hostname', () => {
    assert.strictEqual(formatter.hostname, hostname)
  })
  it('can format an icon url', () => {
    assert.strictEqual(
      formatter.format({ username: 'megabot', type: 'icon' }),
      `${origin}/user/megabot/icon`
    )
  })
  it('can format an image url', () => {
    assert.strictEqual(
      formatter.format({ username: 'megabot', type: 'image' }),
      `${origin}/user/megabot/image`
    )
  })
  it('can unformat an icon url', () => {
    const parts = formatter.unformat(`${origin}/user/megabot/icon`)
    assert.ok(parts.username)
    assert.strictEqual(parts.type, 'icon')
  })
  it('can unformat an image url', () => {
    const parts = formatter.unformat(`${origin}/user/megabot/image`)
    assert.ok(parts.username)
    assert.strictEqual(parts.type, 'image')
  })
})
