import assert from 'node:assert'
import { describe, it } from 'node:test'
describe('package exports', () => {
  it('exposes Bot, BotFactory, default bots, and makeApp', async () => {
    const { Bot, BotFactory, makeApp, DoNothingBot, OKBot } = await import('../lib/index.js')
    assert.equal(typeof Bot, 'function')
    assert.equal(typeof BotFactory, 'function')
    assert.equal(typeof makeApp, 'function')
    assert.equal(typeof OKBot, 'function')
    assert.equal(typeof DoNothingBot, 'function')
  })
})
