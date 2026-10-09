import { describe, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'
import nock from 'nock'
import { nockSetup } from '@evanp/activitypub-nock'

import { Transformer } from '../lib/microsyntax.js'
import as2 from '../lib/activitystreams.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { KeyStorage } from '../lib/keystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { DomainBlocker } from '../lib/domainblocker.js'
import { SafeFetcher } from '../lib/safefetcher.js'
import { HTTPSignature } from '../lib/httpsignature.js'
import { HTTPMessageSignature } from '../lib/httpmessagesignature.js'
import { Digester } from '../lib/digester.js'
import { RequestThrottler } from '../lib/requestthrottler.js'
import { RemoteObjectCache } from '../lib/remoteobjectcache.js'
import { SignaturePolicyStorage } from '../lib/signaturepolicystorage.js'

import { createMigratedTestConnection } from './utils/db.js'

const AS2 = 'https://www.w3.org/ns/activitystreams#'

describe('microsyntax', async () => {
  const tagNamespace = 'https://tags.microsyntax.test/tag/'
  const origin = 'https://local.microsyntax.test'

  nockSetup('social.microsyntax.test')

  const logger = Logger({
    level: 'silent'
  })
  const digester = new Digester(logger)
  const connection = await createMigratedTestConnection()
  const keyStorage = new KeyStorage(connection, logger)
  const formatter = new UrlFormatter(origin)
  const signer = new HTTPSignature(logger)
  const messageSigner = new HTTPMessageSignature(logger)
  const throttler = new RequestThrottler(connection, logger)
  const remoteObjectCache = new RemoteObjectCache(connection, logger)
  const policyStorage = new SignaturePolicyStorage(connection, logger)
  const safeFetcher = new SafeFetcher(new DomainBlocker(null, connection, logger))
  const client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, throttler, remoteObjectCache, messageSigner, policyStorage, safeFetcher, new DomainBlocker(null, connection, logger))
  const transformer = new Transformer(tagNamespace, client, safeFetcher, formatter)

  it('has transformer', () => {
    assert.ok(transformer)
  })

  describe('transform tagless text', async () => {
    const text = 'Hello, world!'
    const { html } = await transformer.transform(text)
    it('has output', () => {
      assert.ok(html)
    })
    it('is the same as input', () => {
      assert.equal(html, `<p>${text}</p>`)
    })
  })

  describe('transform hashtag', async () => {
    const text = 'Hello, World! #greeting'
    const { html, tag } = await transformer.transform(text)
    it('has html output', () => {
      assert.ok(html)
    })
    it('has tag', () => {
      assert.ok(tag)
    })
    it('has correct html', () => {
      assert.equal(html, '<p>Hello, World! <a href="https://tags.microsyntax.test/tag/greeting">#greeting</a></p>')
    })
    it('has correct tag', () => {
      assert.equal(tag.length, 1)
      assert.equal(tag[0].type, AS2 + 'Hashtag')
      assert.equal(tag[0].name, '#greeting')
      assert.equal(tag[0].href, 'https://tags.microsyntax.test/tag/greeting')
    })
  })

  describe('transform url', async () => {
    const text = 'Please visit https://example.com for more information.'
    const { html, tag } = await transformer.transform(text)
    it('has html output', () => {
      assert.ok(html)
    })
    it('has tag', () => {
      assert.ok(tag)
    })
    it('has correct html', () => {
      assert.equal(html, '<p>Please visit <a href="https://example.com">https://example.com</a> for more information.</p>')
    })
    it('has correct tag', () => {
      assert.equal(tag.length, 0)
    })
  })

  describe('transform url with fragment', async () => {
    const text = 'Please visit https://example.com#fragment for more information.'
    const { html, tag } = await transformer.transform(text)
    it('has html output', () => {
      assert.ok(html)
    })
    it('has tag', () => {
      assert.ok(tag)
    })
    it('has correct html', () => {
      assert.equal(html, '<p>Please visit <a href="https://example.com#fragment">https://example.com#fragment</a> for more information.</p>')
    })
    it('has correct tag', () => {
      assert.equal(tag.length, 0)
    })
  })

  describe('transform full mention', async () => {
    const text = 'Hello, @world@social.microsyntax.test !'
    const { html, tag } = await transformer.transform(text)
    it('has html output', () => {
      assert.ok(html)
    })
    it('has tag', () => {
      assert.ok(tag)
    })
    it('has correct html', () => {
      assert.equal(html, '<p>Hello, <a href="https://social.microsyntax.test/profile/world">@world@social.microsyntax.test</a> !</p>')
    })
    it('has correct tag', () => {
      assert.equal(tag.length, 1)
      assert.equal(tag[0].type, 'Mention')
      assert.equal(tag[0].name, '@world@social.microsyntax.test')
      assert.equal(tag[0].href, 'https://social.microsyntax.test/profile/world')
    })
  })

  for (const { label, username, domain, resource } of [
    { label: 'non-ASCII username', username: 'zoë', domain: 'lookup.example', resource: 'acct:zo%C3%AB@lookup.example' },
    { label: 'non-ASCII domain', username: 'user', domain: 'café.example', resource: 'acct:user@xn--caf-dma.example' },
    { label: 'non-ASCII username and domain', username: 'zoë', domain: 'café.example', resource: 'acct:zo%C3%AB@xn--caf-dma.example' }
  ]) {
    it(`linkifies a handle with a ${label}`, async (t) => {
      const mention = `@${username}@${domain}`
      const actorId = new URL(`/user/${username}`, `https://${domain}`).href
      const profileUrl = new URL(`/profile/${username}`, `https://${domain}`).href
      const actor = await as2.import({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: actorId,
        type: 'Person',
        preferredUsername: username,
        url: profileUrl
      })
      const fetch = t.mock.method(safeFetcher, 'fetch', async () => Response.json({
        subject: resource,
        links: [{ rel: 'self', type: 'application/activity+json', href: actorId }]
      }))
      const get = t.mock.method(client, 'get', async () => actor)
      const mentionTransformer = new Transformer(tagNamespace, client, safeFetcher, formatter)

      const { html, tag } = await mentionTransformer.transform(`Hello, ${mention} !`)

      assert.strictEqual(html, `<p>Hello, <a href="${profileUrl}">${mention}</a> !</p>`)
      assert.deepStrictEqual(tag, [{ type: 'Mention', name: mention, href: profileUrl }])
      assert.strictEqual(fetch.mock.callCount(), 1)
      const requestUrl = new URL(fetch.mock.calls[0].arguments[0])
      assert.strictEqual(requestUrl.origin, new URL(`https://${domain}`).origin)
      assert.strictEqual(requestUrl.pathname, '/.well-known/webfinger')
      assert.strictEqual(requestUrl.searchParams.get('resource'), resource)
      assert.strictEqual(get.mock.callCount(), 1)
      assert.strictEqual(get.mock.calls[0].arguments[0], actorId)
    })
  }

  for (const { label, username, escapedUsername, resource } of [
    { label: 'at-sign', username: 'a@b', escapedUsername: 'a@b', resource: 'acct:a%40b@lookup.example' },
    { label: 'ampersand', username: 'a&b', escapedUsername: 'a&amp;b', resource: 'acct:a%26b@lookup.example' },
    { label: 'less-than sign', username: 'a<b', escapedUsername: 'a&lt;b', resource: 'acct:a%3Cb@lookup.example' },
    { label: 'greater-than sign', username: 'a>b', escapedUsername: 'a&gt;b', resource: 'acct:a%3Eb@lookup.example' },
    { label: 'double quote', username: 'a"b', escapedUsername: 'a&quot;b', resource: 'acct:a%22b@lookup.example' },
    { label: 'apostrophe', username: "a'b", escapedUsername: 'a&apos;b', resource: "acct:a'b@lookup.example" }
  ]) {
    it(`linkifies a username containing punctuation (${label}) without changing or double-escaping it`, async (t) => {
      const mention = `@${username}@lookup.example`
      const actorId = 'https://lookup.example/user/punctuation'
      const profileUrl = 'https://lookup.example/profile/punctuation'
      const actor = await as2.import({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: actorId,
        type: 'Person',
        preferredUsername: username,
        url: profileUrl
      })
      const fetch = t.mock.method(safeFetcher, 'fetch', async () => Response.json({
        subject: resource,
        links: [{ rel: 'self', type: 'application/activity+json', href: actorId }]
      }))
      const get = t.mock.method(client, 'get', async () => actor)
      const mentionTransformer = new Transformer(tagNamespace, client, safeFetcher, formatter)

      const { html, tag } = await mentionTransformer.transform(`Hello, ${mention} !`)

      assert.strictEqual(html, `<p>Hello, <a href="${profileUrl}">@${escapedUsername}@lookup.example</a> !</p>`)
      assert.deepStrictEqual(tag, [{ type: 'Mention', name: mention, href: profileUrl }])
      assert.strictEqual(fetch.mock.callCount(), 1)
      const requestUrl = new URL(fetch.mock.calls[0].arguments[0])
      assert.strictEqual(requestUrl.origin, 'https://lookup.example')
      assert.strictEqual(requestUrl.pathname, '/.well-known/webfinger')
      assert.strictEqual(requestUrl.searchParams.get('resource'), resource)
      assert.strictEqual(get.mock.callCount(), 1)
      assert.strictEqual(get.mock.calls[0].arguments[0], actorId)
    })
  }

  describe('transform local mention', async () => {
    const text = 'Hello, @neighbor@local.microsyntax.test !'
    const { html, tag } = await transformer.transform(text)
    it('has html output', () => {
      assert.ok(html)
    })
    it('has tag', () => {
      assert.ok(tag)
    })
    it('has correct html', () => {
      assert.equal(html, '<p>Hello, <a href="https://local.microsyntax.test/profile/neighbor">@neighbor@local.microsyntax.test</a> !</p>')
    })
    it('has correct tag', () => {
      assert.equal(tag.length, 1)
      assert.equal(tag[0].type, 'Mention')
      assert.equal(tag[0].name, '@neighbor@local.microsyntax.test')
      assert.equal(tag[0].href, 'https://local.microsyntax.test/profile/neighbor')
    })
  })

  describe('escape HTML in plain text', async () => {
    const text = 'Hello <script>alert(1)</script> & "friends"'
    const { html, tag } = await transformer.transform(text)
    it('has html output', () => {
      assert.ok(html)
    })
    it('does not pass through a raw <script> tag', () => {
      assert.ok(!html.toLowerCase().includes('<script'))
      assert.ok(!html.toLowerCase().includes('</script'))
    })
    it('escapes <, >, &, and "', () => {
      assert.equal(
        html,
        '<p>Hello &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;friends&quot;</p>'
      )
    })
    it('produces no tags', () => {
      assert.equal(tag.length, 0)
    })
  })

  describe('mention of an actor with a malicious url href', async () => {
    const evilDomain = 'evil.microsyntax.test'
    const evilUser = 'hacker'
    const evilActorId = `https://${evilDomain}/user/${evilUser}`
    nock(`https://${evilDomain}`)
      .persist()
      .get(/^\/\.well-known\/webfinger/)
      .reply(
        200,
        JSON.stringify({
          subject: `acct:${evilUser}@${evilDomain}`,
          links: [{
            rel: 'self',
            type: 'application/activity+json',
            href: evilActorId
          }]
        }),
        { 'Content-Type': 'application/jrd+json' }
      )
    nock(`https://${evilDomain}`)
      .persist()
      .get(`/user/${evilUser}`)
      .reply(
        200,
        JSON.stringify({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: evilActorId,
          type: 'Person',
          preferredUsername: evilUser,
          url: {
            type: 'Link',
            mediaType: 'text/html',
            href: 'javascript:alert(1)'
          }
        }),
        { 'Content-Type': 'application/activity+json' }
      )
    const text = `Hi @${evilUser}@${evilDomain} !`
    const { html } = await transformer.transform(text)
    it('does not interpolate a javascript: URL into the href', () => {
      assert.ok(!html.toLowerCase().includes('javascript:'),
        `html should not contain "javascript:": ${html}`)
    })
  })

  describe('transform url with query string', async () => {
    const text = 'Visit https://example.com/?a=b&c=d for info.'
    const { html, tag } = await transformer.transform(text)
    it('has html output', () => {
      assert.ok(html)
    })
    it('does not double-escape the & in the query string', () => {
      assert.ok(!html.includes('&amp;amp;'),
        `html should not contain "&amp;amp;": ${html}`)
    })
    it('has correct html', () => {
      assert.equal(
        html,
        '<p>Visit <a href="https://example.com/?a=b&amp;c=d">https://example.com/?a=b&amp;c=d</a> for info.</p>'
      )
    })
    it('has no tag', () => {
      assert.equal(tag.length, 0)
    })
  })
})
