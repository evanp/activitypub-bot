import { describe, before, after, it } from 'node:test'
import { BotDataStorage, NoSuchValueError } from '../lib/botdatastorage.js'
import assert from 'node:assert'
import { createMigratedTestConnection } from './utils/db.js'

describe('BotDataStorage', async () => {
  let connection = null
  let storage = null
  before(async () => {
    connection = await createMigratedTestConnection()
  })
  after(async () => {
    await connection.close()
  })
  it('can initialize', async () => {
    storage = new BotDataStorage(connection)
  })
  it('can set a value', async () => {
    await storage.set('test', 'key1', 'value1')
  })
  it('can get a value', async () => {
    const value = await storage.get('test', 'key1')
    assert.equal(value, 'value1')
  })
  it('knows if a value exists', async () => {
    const flag = await storage.has('test', 'key1')
    assert.ok(flag)
  })
  it('knows if a value does not exist', async () => {
    const flag = await storage.has('test', 'nonexistent1')
    assert.ok(!flag)
  })
  it('raises an error on a non-existent value', async () => {
    try {
      await storage.get('test', 'nonexistent2')
      assert.fail('Did not raise an exception getting a nonexistent key')
    } catch (e) {
      assert.ok(e instanceof NoSuchValueError)
    }
  })
  it('can delete a value', async () => {
    await storage.delete('test', 'key1')
  })
  it('knows if a value has been deleted', async () => {
    const flag = await storage.has('test', 'key1')
    assert.ok(!flag)
  })
  it('raises an error on a deleted value', async () => {
    try {
      await storage.get('test', 'key1')
      assert.fail('Did not raise an exception getting a deleted key')
    } catch (e) {
      assert.ok(e instanceof NoSuchValueError)
    }
  })
  it('stores different data at different keys for the same bot', async () => {
    await storage.set('test', 'key2', 'value2')
    await storage.set('test', 'key3', 'value3')
    const value2 = await storage.get('test', 'key2')
    const value3 = await storage.get('test', 'key3')
    assert.notEqual(value2, value3)
  })
  it('stores different data at the same key for different bots', async () => {
    await storage.set('test2', 'key4', 'value4')
    await storage.set('test3', 'key4', 'value5')
    const value4 = await storage.get('test2', 'key4')
    const value5 = await storage.get('test3', 'key4')
    assert.notEqual(value4, value5)
  })
  it('can store numbers', async () => {
    await storage.set('test', 'numberkey1', 23)
    const value = await storage.get('test', 'numberkey1')
    assert.equal(value, 23)
  })
  it('can store arrays', async () => {
    await storage.set('test', 'arraykey1', [1, 2, 3])
    const value = await storage.get('test', 'arraykey1')
    assert.deepEqual(value, [1, 2, 3])
  })
  it('can store objects', async () => {
    await storage.set('test', 'objectkey1', { a: 1, b: 2, c: 3 })
    const value = await storage.get('test', 'objectkey1')
    assert.deepEqual(value, { a: 1, b: 2, c: 3 })
  })
})
