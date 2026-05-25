import { describe, it } from 'node:test'
import assert from 'node:assert'

import Logger from 'pino'
import { nockSetup } from '@evanp/activitypub-nock'

import { Transformer } from '../lib/microsyntax.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { KeyStorage } from '../lib/keystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
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
  const safeFetcher = new SafeFetcher()
  const client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger, throttler, remoteObjectCache, messageSigner, policyStorage, safeFetcher)
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
})
