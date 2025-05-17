import { describe, before, after, it } from 'node:test'
import { KeyStorage } from '../lib/keystorage.js'
import assert from 'node:assert'
import { Sequelize } from 'sequelize'
import Logger from 'pino'

describe('KeyStorage', async () => {
  let connection = null
  let storage = null
  let logger = null
  before(async () => {
    connection = new Sequelize('sqlite::memory:', { logging: false })
    await connection.authenticate()
    logger = new Logger({
      level: 'silent'
    })
  })
  after(async () => {
    await connection.close()
    connection = null
    logger = null
  })
  it('can initialize', async () => {
    storage = new KeyStorage(connection, logger)
    await storage.initialize()
  })
  it('can get a public key', async () => {
    const publicKey = await storage.getPublicKey('test')
    assert.ok(publicKey)
    assert.equal(typeof publicKey, 'string')
    assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(publicKey, /-----END PUBLIC KEY-----\n$/)
  })
  it('can get a public key again', async () => {
    const publicKey = await storage.getPublicKey('test')
    assert.ok(publicKey)
    assert.equal(typeof publicKey, 'string')
    assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(publicKey, /-----END PUBLIC KEY-----\n$/)
  })
  it('can get a private key after getting a public key', async () => {
    const privateKey = await storage.getPrivateKey('test')
    assert.ok(privateKey)
    assert.equal(typeof privateKey, 'string')
    assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(privateKey, /-----END PRIVATE KEY-----\n$/)
  })
  it('can get a private key', async () => {
    const privateKey = await storage.getPrivateKey('test2')
    assert.ok(privateKey)
    assert.equal(typeof privateKey, 'string')
    assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(privateKey, /-----END PRIVATE KEY-----\n$/)
  })
  it('can get a private key again', async () => {
    const privateKey = await storage.getPrivateKey('test2')
    assert.ok(privateKey)
    assert.equal(typeof privateKey, 'string')
    assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(privateKey, /-----END PRIVATE KEY-----\n$/)
  })
  it('can get a public key after getting a private key', async () => {
    const publicKey = await storage.getPublicKey('test2')
    assert.ok(publicKey)
    assert.equal(typeof publicKey, 'string')
    assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(publicKey, /-----END PUBLIC KEY-----\n$/)
  })
  it('can get distinct public keys for distinct bots', async () => {
    const publicKey = await storage.getPublicKey('test')
    const publicKey2 = await storage.getPublicKey('test2')
    assert.ok(publicKey)
    assert.ok(publicKey2)
    assert.notEqual(publicKey, publicKey2)
  })
  it('can get distinct private keys for distinct bots', async () => {
    const privateKey = await storage.getPrivateKey('test')
    const privateKey2 = await storage.getPrivateKey('test2')
    assert.ok(privateKey)
    assert.ok(privateKey2)
    assert.notEqual(privateKey, privateKey2)
  })
})
