import { describe, before, after, it } from 'node:test'
import { KeyStorage } from '../lib/keystorage.js'
import assert from 'node:assert'
import Logger from 'pino'
import { createMigratedTestConnection, cleanupTestData } from './utils/db.js'

const BOT1 = 'keystoragetest1'
const BOT2 = 'keystoragetest2'
const SYSTEM_BOT = ''
const TEST_BOTS = [BOT1, BOT2, SYSTEM_BOT]

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
    connection = await createMigratedTestConnection()
    await cleanupTestData(connection, { usernames: TEST_BOTS })
    logger = new Logger({
      level: 'silent'
    })
  })
  after(async () => {
    await cleanupTestData(connection, { usernames: TEST_BOTS })
    await connection.close()
    connection = null
    storage = null
    logger = null
  })
  it('can initialize', async () => {
    storage = new KeyStorage(connection, logger)
  })
  it('can get a public key', async () => {
    firstPublicKey = await storage.getPublicKey(BOT1)
    assert.ok(firstPublicKey)
    assert.equal(typeof firstPublicKey, 'string')
    assert.match(firstPublicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(firstPublicKey, /-----END PUBLIC KEY-----\n$/)
  })
  it('can get a public key again', async () => {
    secondPublicKey = await storage.getPublicKey(BOT1)
    assert.ok(secondPublicKey)
    assert.equal(typeof secondPublicKey, 'string')
    assert.match(secondPublicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(secondPublicKey, /-----END PUBLIC KEY-----\n$/)
    assert.equal(firstPublicKey, secondPublicKey)
  })
  it('can get a private key after getting a public key', async () => {
    const privateKey = await storage.getPrivateKey(BOT1)
    assert.ok(privateKey)
    assert.equal(typeof privateKey, 'string')
    assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(privateKey, /-----END PRIVATE KEY-----\n$/)
  })
  it('can get a private key', async () => {
    firstPrivateKey = await storage.getPrivateKey(BOT2)
    assert.ok(firstPrivateKey)
    assert.equal(typeof firstPrivateKey, 'string')
    assert.match(firstPrivateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(firstPrivateKey, /-----END PRIVATE KEY-----\n$/)
  })
  it('can get a private key again', async () => {
    secondPrivateKey = await storage.getPrivateKey(BOT2)
    assert.ok(secondPrivateKey)
    assert.equal(typeof secondPrivateKey, 'string')
    assert.match(secondPrivateKey, /^-----BEGIN PRIVATE KEY-----\n/)
    assert.match(secondPrivateKey, /-----END PRIVATE KEY-----\n$/)
    assert.equal(firstPrivateKey, secondPrivateKey)
  })
  it('can get a public key after getting a private key', async () => {
    const publicKey = await storage.getPublicKey(BOT2)
    assert.ok(publicKey)
    assert.equal(typeof publicKey, 'string')
    assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----\n/)
    assert.match(publicKey, /-----END PUBLIC KEY-----\n$/)
  })
  it('can get distinct public keys for distinct bots', async () => {
    const publicKey = await storage.getPublicKey(BOT1)
    const publicKey2 = await storage.getPublicKey(BOT2)
    assert.ok(publicKey)
    assert.ok(publicKey2)
    assert.notEqual(publicKey, publicKey2)
  })
  it('can get distinct private keys for distinct bots', async () => {
    const privateKey = await storage.getPrivateKey(BOT1)
    const privateKey2 = await storage.getPrivateKey(BOT2)
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
