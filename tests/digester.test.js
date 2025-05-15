import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import Logger from 'pino'
import { Digester } from '../lib/digester.js'

describe('Digester', () => {
  let digester = null
  let logger = null

  before(() => {
    logger = new Logger({
      level: 'silent'
    })
  })

  after(async () => {
    logger = null
  })

  it('can initialize', async () => {
    digester = new Digester(logger)
    assert.ok(digester)
  })

  it('can digest a string', async () => {
    const text = 'Hello, world!'
    const digest = await digester.digest(text)
    assert.ok(digest)
    assert.equal(digest, 'sha-256=MV9b23bQeMQ7isAGTkoBZGErH853yGk0W/yUx1iU7dM=')
  })

  it('can compare two equal digests', async () => {
    const text = 'Hello, world!'
    const digest1 = await digester.digest(text)
    const digest2 = await digester.digest(text)
    const result = await digester.equals(digest1, digest2)
    assert.ok(result)
  })

  it('can compare two different digests', async () => {
    const text1 = 'Hello, world!'
    const text2 = 'Hello, world!!'
    const digest1 = await digester.digest(text1)
    const digest2 = await digester.digest(text2)
    const result = await digester.equals(digest1, digest2)
    assert.ok(!result)
  })

  it('can compare two digests that differ only in case of the algorithm', async () => {
    const text = 'Hello, world!'
    const digest1 = await digester.digest(text)
    const digest2 = digest1.replace('sha-256', 'SHA-256')
    const result = await digester.equals(digest1, digest2)
    assert.ok(result)
  })
})
