import { describe, before, after, it } from 'node:test'
import { KeyStorage } from '../lib/keystorage.js'
import assert from 'node:assert'
import { Sequelize } from 'sequelize'
import Logger from 'pino'
import { runMigrations } from '../lib/migrations/index.js'

describe('KeyStorage', async () => {
  let connection = null
  let storage = null
  let logger = null
  let firstPublicKey = null
  let firstPrivateKey = null
  let secondPublicKey = null
  let secondPrivateKey = null
  let firstSystemPublicKey = null
  let firstSystemPrivateKey = null
  let secondSystemPublicKey = null
  let secondSystemPrivateKey = null
  before(async () => {
    connection = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    await connection.authenticate()
    await runMigrations(connection)
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
  })
  it('can get a public key', async () => {
    firstPublicKey = await storage.getPublicKey('test1')
    assert.ok(firstPublicKey)
    assert.equal(typeof firstPublicKey, 'string')
    assert.match(firstPublicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(firstPublicKey, /-----END PUBLIC KEY-----\n$/)
  })
  it('can get a public key again', async () => {
    secondPublicKey = await storage.getPublicKey('test1')
    assert.ok(secondPublicKey)
    assert.equal(typeof secondPublicKey, 'string')
    assert.match(secondPublicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(secondPublicKey, /-----END PUBLIC KEY-----\n$/)
    assert.equal(firstPublicKey, secondPublicKey)
  })
  it('can get a private key after getting a public key', async () => {
    const privateKey = await storage.getPrivateKey('test1')
    assert.ok(privateKey)
    assert.equal(typeof privateKey, 'string')
    assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(privateKey, /-----END PRIVATE KEY-----\n$/)
  })
  it('can get a private key', async () => {
    firstPrivateKey = await storage.getPrivateKey('test2')
    assert.ok(firstPrivateKey)
    assert.equal(typeof firstPrivateKey, 'string')
    assert.match(firstPrivateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(firstPrivateKey, /-----END PRIVATE KEY-----\n$/)
  })
  it('can get a private key again', async () => {
    secondPrivateKey = await storage.getPrivateKey('test2')
    assert.ok(secondPrivateKey)
    assert.equal(typeof secondPrivateKey, 'string')
    assert.match(secondPrivateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(secondPrivateKey, /-----END PRIVATE KEY-----\n$/)
    assert.equal(firstPrivateKey, secondPrivateKey)
  })
  it('can get a public key after getting a private key', async () => {
    const publicKey = await storage.getPublicKey('test2')
    assert.ok(publicKey)
    assert.equal(typeof publicKey, 'string')
    assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(publicKey, /-----END PUBLIC KEY-----\n$/)
  })
  it('can get distinct public keys for distinct bots', async () => {
    const publicKey = await storage.getPublicKey('test1')
    const publicKey2 = await storage.getPublicKey('test2')
    assert.ok(publicKey)
    assert.ok(publicKey2)
    assert.notEqual(publicKey, publicKey2)
  })
  it('can get distinct private keys for distinct bots', async () => {
    const privateKey = await storage.getPrivateKey('test1')
    const privateKey2 = await storage.getPrivateKey('test2')
    assert.ok(privateKey)
    assert.ok(privateKey2)
    assert.notEqual(privateKey, privateKey2)
  })
  it('can get a system public key', async () => {
    firstSystemPublicKey = await storage.getPublicKey(null)
    assert.ok(firstSystemPublicKey)
    assert.equal(typeof firstSystemPublicKey, 'string')
    assert.match(firstSystemPublicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(firstSystemPublicKey, /-----END PUBLIC KEY-----\n$/)
  })
  it('can get a system public key again', async () => {
    secondSystemPublicKey = await storage.getPublicKey(null)
    assert.ok(secondSystemPublicKey)
    assert.equal(typeof secondSystemPublicKey, 'string')
    assert.match(secondSystemPublicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(secondSystemPublicKey, /-----END PUBLIC KEY-----\n$/)
    assert.equal(firstSystemPublicKey, secondSystemPublicKey)
  })
  it('can get a system private key', async () => {
    firstSystemPrivateKey = await storage.getPrivateKey(null)
    assert.ok(firstSystemPrivateKey)
    assert.equal(typeof firstSystemPrivateKey, 'string')
    assert.match(firstSystemPrivateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(firstSystemPrivateKey, /-----END PRIVATE KEY-----\n$/)
  })
  it('can get a system private key again', async () => {
    secondSystemPrivateKey = await storage.getPrivateKey(null)
    assert.ok(secondSystemPrivateKey)
    assert.equal(typeof secondSystemPrivateKey, 'string')
    assert.match(secondSystemPrivateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(secondSystemPrivateKey, /-----END PRIVATE KEY-----\n$/)
    assert.equal(firstSystemPrivateKey, secondSystemPrivateKey)
  })
})
