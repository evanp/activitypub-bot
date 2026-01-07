import { describe, it } from 'node:test'
import assert from 'node:assert'
import { UrlFormatter } from '../lib/urlformatter.js'

describe('UrlFormatter', () => {
  const origin = 'https://activitypubbot.example'
  let formatter = null
  it('can initialize', () => {
    formatter = new UrlFormatter(origin)
  })
  it('can format a user URL', () => {
    const url = formatter.format({ username: 'megabot' })
    assert.equal(url, 'https://activitypubbot.example/user/megabot')
  })
  it('can format a public key URL', () => {
    const url = formatter.format({ username: 'megabot', type: 'publickey' })
    assert.equal(url, 'https://activitypubbot.example/user/megabot/publickey')
  })
  it('can format an inbox URL', () => {
    const url = formatter.format({ username: 'megabot', collection: 'inbox' })
    assert.equal(url, 'https://activitypubbot.example/user/megabot/inbox')
  })
  it('can format an inbox URL page', () => {
    const url = formatter.format({
      username: 'megabot',
      collection: 'inbox',
      page: 3
    })
    assert.equal(url, 'https://activitypubbot.example/user/megabot/inbox/3')
  })
  it('can format an activity URL', () => {
    const url = formatter.format({
      username: 'megabot',
      type: 'like',
      nanoid: 'LNPUlv9kmvhAdr4eoqkil'
    })
    assert.equal(url, 'https://activitypubbot.example/user/megabot/like/LNPUlv9kmvhAdr4eoqkil')
  })
  it('can format a note URL', () => {
    const url = formatter.format({
      username: 'megabot',
      type: 'note',
      nanoid: 'LNPUlv9kmvhAdr4eoqkil'
    })
    assert.equal(url, 'https://activitypubbot.example/user/megabot/note/LNPUlv9kmvhAdr4eoqkil')
  })
  it('can format a note replies URL', () => {
    const url = formatter.format({
      username: 'megabot',
      type: 'note',
      nanoid: 'LNPUlv9kmvhAdr4eoqkil',
      collection: 'replies'
    })
    assert.equal(url, 'https://activitypubbot.example/user/megabot/note/LNPUlv9kmvhAdr4eoqkil/replies')
  })
  it('can format a note replies page URL', () => {
    const url = formatter.format({
      username: 'megabot',
      type: 'note',
      nanoid: 'LNPUlv9kmvhAdr4eoqkil',
      collection: 'replies',
      page: 4
    })
    assert.equal(url, 'https://activitypubbot.example/user/megabot/note/LNPUlv9kmvhAdr4eoqkil/replies/4')
  })
  it('can format a server URL', () => {
    const url = formatter.format({
      server: true
    })
    assert.equal(url, 'https://activitypubbot.example/')
  })
  it('can format a server public key URL', () => {
    const url = formatter.format({
      server: true,
      type: 'publickey'
    })
    assert.equal(url, 'https://activitypubbot.example/publickey')
  })
  it('can tell if an URL is local', () => {
    assert.ok(formatter.isLocal('https://activitypubbot.example/user/megabot'))
    assert.ok(!formatter.isLocal('https://social.example/user/megabot'))
  })
  it('can get a username from a user URL', () => {
    const username = formatter.getUserName('https://activitypubbot.example/user/megabot')
    assert.equal(username, 'megabot')
  })
  it('refuses to unformat a remote URL', () => {
    assert.throws(() => formatter.unformat(
      'https://remote.example/some/unrelated/33/path/format'
    ))
  })
  it('can unformat a user URL', () => {
    const parts = formatter.unformat(
      'https://activitypubbot.example/user/megabot'
    )
    assert.equal(parts.username, 'megabot')
  })
  it('can unformat a public key URL', () => {
    const parts = formatter.unformat(
      'https://activitypubbot.example/user/megabot/publickey'
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'publickey')
  })
  it('can unformat an inbox URL', () => {
    const parts = formatter.unformat(
      'https://activitypubbot.example/user/megabot/inbox'
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.collection, 'inbox')
  })
  it('can unformat an inbox page URL', () => {
    const parts = formatter.unformat(
      'https://activitypubbot.example/user/megabot/inbox/3'
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.collection, 'inbox')
    assert.equal(parts.page, 3)
  })
  it('can unformat an activity URL', () => {
    const parts = formatter.unformat(
      'https://activitypubbot.example/user/megabot/like/LNPUlv9kmvhAdr4eoqkil'
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'like')
    assert.equal(parts.nanoid, 'LNPUlv9kmvhAdr4eoqkil')
  })
  it('can unformat a note URL', () => {
    const parts = formatter.unformat(
      'https://activitypubbot.example/user/megabot/note/LNPUlv9kmvhAdr4eoqkil'
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'note')
    assert.equal(parts.nanoid, 'LNPUlv9kmvhAdr4eoqkil')
  })
  it('can unformat a note replies URL', () => {
    const parts = formatter.unformat(
      'https://activitypubbot.example/user/megabot/note/LNPUlv9kmvhAdr4eoqkil/replies'
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'note')
    assert.equal(parts.nanoid, 'LNPUlv9kmvhAdr4eoqkil')
    assert.equal(parts.collection, 'replies')
  })
  it('can unformat a note replies page URL', () => {
    const parts = formatter.unformat(
      'https://activitypubbot.example/user/megabot/note/LNPUlv9kmvhAdr4eoqkil/replies/4'
    )
    assert.equal(parts.username, 'megabot')
    assert.equal(parts.type, 'note')
    assert.equal(parts.nanoid, 'LNPUlv9kmvhAdr4eoqkil')
    assert.equal(parts.collection, 'replies')
    assert.equal(parts.page, 4)
  })
  it('can unformat a server URL', () => {
    const parts = formatter.unformat('https://activitypubbot.example/')
    assert.ok(parts.server)
  })
  it('can unformat a server public key URL', () => {
    const parts = formatter.unformat('https://activitypubbot.example/publickey')
    assert.ok(parts.server)
    assert.equal(parts.type, 'publickey')
  })
})
