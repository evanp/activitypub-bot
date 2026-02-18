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

  it('exports RelayClientBot', async () => {
    const RelayClientBot = module.RelayClientBot
    assert.equal(typeof RelayClientBot, 'function')
  })

  it('exports RelayServerBot', async () => {
    const RelayServerBot = module.RelayServerBot
    assert.equal(typeof RelayServerBot, 'function')
  })
})
