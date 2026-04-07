import assert from 'node:assert'

import createHttpError from 'http-errors'

import BotMaker from './botmaker.js'

export class HTTPSignatureAuthenticator {
  static #maxDateDiff = 5 * 60 * 1000 // 5 minutes
  #remoteKeyStorage
  #logger
  #digester
  #signer
  #messageSigner

  constructor (remoteKeyStorage, signer, messageSigner, digester, logger) {
    assert.ok(remoteKeyStorage)
    assert.strictEqual(typeof remoteKeyStorage, 'object')
    assert.ok(signer)
    assert.strictEqual(typeof signer, 'object')
    assert.ok(messageSigner)
    assert.strictEqual(typeof messageSigner, 'object')
    assert.ok(digester)
    assert.strictEqual(typeof digester, 'object')
    assert.ok(logger)
    assert.strictEqual(typeof logger, 'object')
    this.#remoteKeyStorage = remoteKeyStorage
    this.#signer = signer
    this.#messageSigner = messageSigner
    this.#digester = digester
    this.#logger = logger.child({ class: this.constructor.name })
  }

  async authenticate (req, res, next) {
    const { formatter, origin, bots } = req.app.locals

    const signature = req.get('Signature')
    if (!signature) {
      // Just continue
      return next()
    }

    const originalUrl = req.originalUrl
    const fullUrl = `${origin}${originalUrl}`
    let parts
    try {
      parts = formatter.unformat(fullUrl)
    } catch (err) {
      // do nothing
      this.#logger.debug({ fullUrl, err }, 'Could not unformat')
    }
    if (parts && parts.username) {
      this.#logger.debug({ username: parts.username }, 'Request for bot')
      const bot = await BotMaker.makeBot(bots, parts.username)
      if (!bot) {
        this.#logger.warn({ username: parts.username }, 'no such bot')
      } else if (!bot.checkSignature) {
        this.#logger.debug({ username: parts.username }, 'bot says no sig')
        return next()
      }
    }

    const signatureInput = req.get('Signature-Input')

    try {
      if (signatureInput) {
        await this.#authenticateMessageSignature(signature, signatureInput, originalUrl, req, res, next)
      } else {
        await this.#authenticateSignature(signature, originalUrl, req, res, next)
      }
    } catch (err) {
      this.#logger.debug({ err }, 'Error authenticating key')
      return next(err)
    }
  }

  async #authenticateSignature (signature, originalUrl, req, res, next) {
    this.#logger.debug({ signature }, 'Got signed request')
    const date = req.get('Date')
    if (!date) {
      throw createHttpError(400, 'No date provided')
    }
    if (Math.abs(Date.parse(date) - Date.now()) >
        HTTPSignatureAuthenticator.#maxDateDiff) {
      throw createHttpError(400, 'Time skew too large')
    }
    if (req.rawBodyText && req.rawBodyText.length > 0) {
      const digest = req.get('Digest')
      if (!digest) {
        throw createHttpError(400, 'No digest provided')
      }
      const calculated = await this.#digester.digest(req.rawBodyText)
      if (!this.#digester.equals(digest, calculated)) {
        this.#logger.debug(`calculated: ${calculated} digest: ${digest}`)
        throw createHttpError(400, 'Digest mismatch')
      }
    }
    const { method, headers } = req
    this.#logger.debug({ originalUrl }, 'original URL')
    const keyId = this.#signer.keyId(signature)
    this.#logger.debug({ keyId }, 'Signed with keyId')
    const ok = await this.#remoteKeyStorage.getPublicKey(keyId)
    if (!ok) {
      throw createHttpError(400, 'public key not found')
    }
    let owner = ok.owner
    let publicKeyPem = ok.publicKeyPem
    let result = await this.#signer.validate(publicKeyPem, signature, method, originalUrl, headers)
    this.#logger.debug(`First validation result: ${result}`)
    if (!result) {
      // May be key rotation. Try again with uncached key
      const ok2 = await this.#remoteKeyStorage.getPublicKey(keyId, false)
      if (ok2.publicKeyPem === ok.publicKeyPem) {
        this.#logger.debug('same keys')
      } else {
        this.#logger.debug('different keys')
        owner = ok2.owner
        publicKeyPem = ok2.publicKeyPem
        result = await this.#signer.validate(publicKeyPem, signature, method, originalUrl, headers)
        this.#logger.debug(`Validation result: ${result}`)
      }
    }
    if (result) {
      this.#logger.debug(`Signature valid for ${keyId}`)
      req.auth = req.auth || {}
      req.auth.subject = owner
      return next()
    } else {
      throw createHttpError(401, 'Unauthorized')
    }
  }

  async #authenticateMessageSignature (signature, signatureInput, originalUrl, req, res, next) {
    this.#logger.debug(
      { signature, signatureInput, originalUrl },
      'authenticating message signature'
    )
    const date = req.get('Date')
    if (date && Math.abs(Date.parse(date) - Date.now()) >
        HTTPSignatureAuthenticator.#maxDateDiff) {
      throw createHttpError(400, 'Time skew too large')
    }
    if (req.rawBodyText && req.rawBodyText.length > 0) {
      const digest = req.get('Content-Digest')
      if (!digest) {
        throw createHttpError(400, 'No digest provided')
      }
      const calculated = await this.#digester.contentDigest(req.rawBodyText)
      if (!this.#digester.equals(digest, calculated)) {
        this.#logger.debug(`calculated: ${calculated} digest: ${digest}`)
        throw createHttpError(400, 'Digest mismatch')
      }
    }
    const created = this.#messageSigner.created(signatureInput)
    if (!created) {
      throw createHttpError(400, 'No created timestamp provided')
    }
    if (Math.abs(Date.now() - created * 1000) > HTTPSignatureAuthenticator.#maxDateDiff) {
      throw createHttpError(400, 'Time skew too large')
    }
    const { method, headers } = req
    const { origin } = req.app.locals
    const url = `${origin}${originalUrl}`

    const keyId = this.#messageSigner.keyId(signatureInput)
    if (!keyId) {
      throw createHttpError(400, 'no public key provided')
    }
    this.#logger.debug({ keyId }, 'Signed with keyId')
    const ok = await this.#remoteKeyStorage.getPublicKey(keyId)
    if (!ok) {
      throw createHttpError(400, 'public key not found')
    }
    let owner = ok.owner
    let publicKeyPem = ok.publicKeyPem
    let result = await this.#messageSigner.validate(publicKeyPem, signatureInput, signature, method, url, headers)
    this.#logger.debug(`First validation result: ${result}`)
    if (!result) {
      // May be key rotation. Try again with uncached key
      const ok2 = await this.#remoteKeyStorage.getPublicKey(keyId, false)
      if (ok2.publicKeyPem === ok.publicKeyPem) {
        this.#logger.debug('same keys')
      } else {
        this.#logger.debug('different keys')
        owner = ok2.owner
        publicKeyPem = ok2.publicKeyPem
        result = await this.#messageSigner.validate(publicKeyPem, signatureInput, signature, method, url, headers)
        this.#logger.debug(`Validation result: ${result}`)
      }
    }
    if (result) {
      this.#logger.debug(`Signature valid for ${keyId}`)
      req.auth = req.auth || {}
      req.auth.subject = owner
      return next()
    } else {
      throw createHttpError(401, 'Unauthorized')
    }
  }
}
