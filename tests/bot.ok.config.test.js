import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import OKBot from '../lib/bots/ok.js'

async function replyToMention (bot, webfinger = null) {
  const replies = []
  const data = new Map()
  await bot.initialize({
    botId: bot.username,
    logger: { debug () {}, info () {} },
    async toWebfinger () { return webfinger },
    async hasData (key) { return data.has(key) },
    async setData (key, value) { data.set(key, value) },
    async sendReply (content, object) {
      replies.push(content)
      return { id: 'https://local.test/reply', inReplyTo: { id: object.id } }
    }
  })
  const object = {
    id: 'https://remote.test/note',
    attributedTo: { first: { id: 'https://remote.test/actor' } }
  }
  const activity = { id: 'https://remote.test/create' }
  await bot.onMention(object, activity)
  await bot.onMention(object, activity)
  assert.equal(replies.length, 1, 'a repeated mention must not produce another reply')
  return replies[0]
}

describe('OKBot configuration', () => {
  it('defaults fullname to the username followed by " bot"', () => {
    assert.equal(new OKBot('eightball').fullname, 'eightball bot')
  })

  it('honors an explicit fullname', () => {
    assert.equal(new OKBot('eightball', { fullname: 'Magic 8-Ball' }).fullname, 'Magic 8-Ball')
  })

  it('honors an explicit description', () => {
    assert.equal(new OKBot('eightball', { description: 'Ask me anything.' }).description, 'Ask me anything.')
  })

  for (const [label, options, expected] of [
    ['default content', {}, 'eightball'],
    ['a string', { content: 'Oui' }, 'Oui'],
    ['a one-element array', { content: ['Oui'] }, 'Oui']
  ]) {
    it(`describes ${label}`, () => {
      const description = Array.isArray(options.content)
        ? 'A bot that says random things when mentioned.'
        : `A bot that says "${expected}" when mentioned.`
      assert.equal(new OKBot('eightball', options).description, description)
    })

    it(`replies with ${label}`, async () => {
      assert.equal(await replyToMention(new OKBot('eightball', options)), expected)
    })
  }

  it('describes multiple responses', () => {
    const bot = new OKBot('eightball', { content: ['Yes', 'No', 'Ask again later'] })
    assert.equal(bot.description, 'A bot that says random things when mentioned.')
  })

  it('preserves the recipient mention before the configured response', async () => {
    const bot = new OKBot('eightball', { content: 'Oui' })
    assert.equal(await replyToMention(bot, 'alice@remote.test'), '@alice@remote.test Oui')
  })

  it('can randomly select every response', async (t) => {
    const content = ['Yes', 'No', 'Ask again later']
    for (const [random, expected] of [[0, 'Yes'], [0.5, 'No'], [0.999999, 'Ask again later']]) {
      t.mock.method(Math, 'random', () => random)
      assert.equal(await replyToMention(new OKBot('eightball', { content })), expected)
      t.mock.restoreAll()
    }
  })
})
