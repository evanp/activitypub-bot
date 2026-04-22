import assert from 'node:assert'
import { describe, it } from 'node:test'

describe('package exports', () => {
  let module

  it('can import the index', async () => {
    module = await import('../lib/index.js')
    assert.ok(module)
    assert.strictEqual(typeof module, 'object')
  })

  it('exports Bot', async () => {
    const Bot = module.Bot
    assert.equal(typeof Bot, 'function')
  })

  it('exports BotFactory', async () => {
    const BotFactory = module.BotFactory
    assert.equal(typeof BotFactory, 'function')
  })

  it('exports makeApp', async () => {
    const makeApp = module.makeApp
    assert.equal(typeof makeApp, 'function')
  })

  it('exports OKBot', async () => {
    const OKBot = module.OKBot
    assert.equal(typeof OKBot, 'function')
  })

  it('exports DoNothingBot', async () => {
    const DoNothingBot = module.DoNothingBot
    assert.equal(typeof DoNothingBot, 'function')
  })

  it('exports MastodonRelayClientBot', async () => {
    const MastodonRelayClientBot = module.MastodonRelayClientBot
    assert.equal(typeof MastodonRelayClientBot, 'function')
  })

  it('exports MastodonRelayServerBot', async () => {
    const MastodonRelayServerBot = module.MastodonRelayServerBot
    assert.equal(typeof MastodonRelayServerBot, 'function')
  })

  it('exports FollowBackBot', async () => {
    const FollowBackBot = module.FollowBackBot
    assert.equal(typeof FollowBackBot, 'function')
  })

  it('exports LitePubRelayClientBot', async () => {
    const LitePubRelayClientBot = module.LitePubRelayClientBot
    assert.equal(typeof LitePubRelayClientBot, 'function')
  })

  it('exports LitePubRelayServerBot', async () => {
    const LitePubRelayServerBot = module.LitePubRelayServerBot
    assert.equal(typeof LitePubRelayServerBot, 'function')
  })

  it('exports RelayClientBot as an alias for MastodonRelayClientBot', async () => {
    assert.equal(typeof module.RelayClientBot, 'function')
    assert.strictEqual(module.RelayClientBot, module.MastodonRelayClientBot)
  })

  it('exports RelayServerBot as an alias for MastodonRelayServerBot', async () => {
    assert.equal(typeof module.RelayServerBot, 'function')
    assert.strictEqual(module.RelayServerBot, module.MastodonRelayServerBot)
  })
})
