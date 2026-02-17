import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Transformer } from '../lib/microsyntax.js'
import { UrlFormatter } from '../lib/urlformatter.js'
import { KeyStorage } from '../lib/keystorage.js'
import { ActivityPubClient } from '../lib/activitypubclient.js'
import { nockSetup } from '@evanp/activitypub-nock'
import { HTTPSignature } from '../lib/httpsignature.js'
import Logger from 'pino'
import { Digester } from '../lib/digester.js'
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
  const client = new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
  const transformer = new Transformer(tagNamespace, client)

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
})
