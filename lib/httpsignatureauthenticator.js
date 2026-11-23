import assert from 'node:assert'
import crypto from 'node:crypto'

import { ProblemDetailsError } from './errors/problemdetailserror.js'
import { verifySignature, SignatureErrorCode, isSignatureError } from 'http-message-sig'

import BotMaker from './botmaker.js'

export function authenticate (req, res, next) {
  const { signature } = req.app.locals
  return signature.authenticate(req, res, next)
}

export class HTTPSignatureAuthenticator {
  static #maxDateDiff = 5 * 60 * 1000 // 5 minutes
  #remoteKeyStorage
  #logger
  #digester
  #signer

  constructor (remoteKeyStorage, signer, digester, logger) {
    assert.ok(remoteKeyStorage)
    assert.strictEqual(typeof remoteKeyStorage, 'object')
    assert.ok(signer)
    assert.strictEqual(typeof signer, 'object')
    assert.ok(digester)
    assert.strictEqual(typeof digester, 'object')
    assert.ok(logger)
    assert.strictEqual(typeof logger, 'object')
    this.#remoteKeyStorage = remoteKeyStorage
    this.#signer = signer
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
      this.#logger.debug({ reqId: req.id, fullUrl, err }, 'Could not unformat')
    }
    if (parts && parts.username) {
      this.#logger.debug({ reqId: req.id, username: parts.username }, 'Request for bot')
      const bot = await BotMaker.makeBot(bots, parts.username)
      if (!bot) {
        this.#logger.warn({ reqId: req.id, username: parts.username }, 'no such bot')
      } else if (!bot.checkSignature) {
        this.#logger.debug({ reqId: req.id, username: parts.username }, 'bot says no sig')
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
      this.#logger.debug({ reqId: req.id, err }, 'Error authenticating key')
      return next(err)
    }
  }

  async #authenticateSignature (signature, originalUrl, req, res, next) {
    const { domainBlocker } = req.app.locals
    this.#logger.debug({ reqId: req.id, signature }, 'Got signed request')
    const algorithm = this.#signer.algorithm(signature)
    const created = this.#signer.created(signature)
    const expires = this.#signer.expires(signature)
    if (algorithm === 'hs2019' && created !== null) {
      if (Math.abs(Date.now() - created * 1000) > HTTPSignatureAuthenticator.#maxDateDiff) {
        throw new ProblemDetailsError(401, 'Time skew too large')
      }
    }
    const date = req.get('Date')
    if (!date && !(algorithm === 'hs2019' && created)) {
      throw new ProblemDetailsError(401, 'No date provided')
    }
    if (date && Math.abs(Date.parse(date) - Date.now()) >
          HTTPSignatureAuthenticator.#maxDateDiff) {
      throw new ProblemDetailsError(401, 'Time skew too large')
    }
    if (expires !== null && (Date.now() - expires * 1000 > 0)) {
      throw new ProblemDetailsError(401, 'Signature expired')
    }
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (!Object.hasOwn(req, 'rawBodyText') || req.rawBodyText === null) {
        throw new ProblemDetailsError(400, 'No body for request')
      }
      const digest = req.get('Digest')
      if (!digest) {
        throw new ProblemDetailsError(401, 'No digest provided')
      }
      const calculated = await this.#digester.digest(req.rawBodyText)
      if (!this.#digester.equals(digest, calculated)) {
        this.#logger.debug({ reqId: req.id, calculated, digest }, 'Digest mismatch')
        throw new ProblemDetailsError(401, 'Digest mismatch')
      }
    }
    const { method, headers } = req
    this.#logger.debug({ reqId: req.id, originalUrl }, 'original URL')
    const keyId = this.#signer.keyId(signature)
    this.#logger.debug({ reqId: req.id, keyId }, 'Signed with keyId')
    if (await domainBlocker.isBlocked(keyId)) {
      throw new ProblemDetailsError(403, 'not allowed')
    }
    const ok = await this.#remoteKeyStorage.getPublicKey(keyId)
    if (!ok) {
      throw new ProblemDetailsError(401, 'public key not found')
    }
    let owner = ok.owner
    let publicKeyPem = ok.publicKeyPem
    let result = await this.#signer.validate(publicKeyPem, signature, method, originalUrl, headers)
    this.#logger.debug({ reqId: req.id, result }, 'First validation result')
    if (!result) {
      // May be key rotation. Try again with uncached key
      const ok2 = await this.#remoteKeyStorage.getPublicKey(keyId, false)
      if (!ok2) {
        throw new ProblemDetailsError(401, 'public key not found')
      }
      if (ok2.publicKeyPem === ok.publicKeyPem) {
        this.#logger.debug({ reqId: req.id }, 'same keys')
      } else {
        this.#logger.debug({ reqId: req.id }, 'different keys')
        owner = ok2.owner
        publicKeyPem = ok2.publicKeyPem
        result = await this.#signer.validate(publicKeyPem, signature, method, originalUrl, headers)
        this.#logger.debug({ reqId: req.id, result }, 'Validation result')
      }
    }
    if (result) {
      this.#logger.debug({ reqId: req.id, keyId }, 'Signature valid')
      req.auth = req.auth || {}
      req.auth.subject = owner
      return next()
    } else {
      throw new ProblemDetailsError(401, 'Unauthorized')
    }
  }

  async #authenticateMessageSignature (signature, signatureInput, originalUrl, req, res, next) {
    this.#logger.debug(
      { reqId: req.id, signature, signatureInput, originalUrl },
      'authenticating message signature'
    )
    const { domainBlocker } = req.app.locals
    const date = req.get('Date')
    if (date && Math.abs(Date.parse(date) - Date.now()) >
        HTTPSignatureAuthenticator.#maxDateDiff) {
      throw new ProblemDetailsError(401, 'Time skew too large')
    }
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (!Object.hasOwn(req, 'rawBodyText') || req.rawBodyText === null) {
        throw new ProblemDetailsError(400, 'No body for request')
      }
      const digest = req.get('Content-Digest')
      if (!digest) {
        throw new ProblemDetailsError(401, 'No digest provided')
      }
      const calculated = await this.#digester.contentDigest(req.rawBodyText)
      if (!this.#digester.equals(digest, calculated)) {
        this.#logger.debug({ reqId: req.id, calculated, digest }, 'Digest mismatch')
        throw new ProblemDetailsError(401, 'Digest mismatch')
      }
    }

    let result = await this.#verify(req, { useCache: true, domainBlocker })
    this.#logger.debug({ reqId: req.id, result }, 'First validation result')
    if (!result) {
      result = await this.#verify(req, { useCache: false, domainBlocker })
      this.#logger.debug({ reqId: req.id, result }, 'Second validation result')
    }
    if (result) {
      this.#logger.debug(
        { reqId: req.id, keyid: result.parameters.keyid, owner: result.verifier.owner },
        'Signature valid'
      )
      req.auth = req.auth || {}
      req.auth.subject = result.verifier.owner
      return next()
    } else {
      throw new ProblemDetailsError(401, 'Unauthorized')
    }
  }

  async #verify (req, options = {}) {
    const message = this.#reqToMessage(req)
    const requiredComponents = ['@method', '@target-uri']
    if (['POST', 'PUT', 'PATCH'].includes(message.method)) {
      requiredComponents.push('content-digest')
    }
    let result
    try {
      result = await verifySignature(message, {
        policy: {
          algorithms: ['rsa-v1_5-sha256'],
          requiredParameters: ['created', 'keyid'],
          requiredComponents,
          maxAge: 0,
          clockSkew: 300
        },
        resolveVerifier: this.#resolveVerifier.bind(this, options.useCache, options.domainBlocker)
      })
    } catch (err) {
      if (isSignatureError(err)) {
        if (err.code === SignatureErrorCode.VerificationFailed) {
          return null
        } else if (err.code === SignatureErrorCode.ResolverFailed) {
          if (err.cause instanceof ProblemDetailsError) {
            throw err.cause
          } else {
            throw err
          }
        } else {
          throw new ProblemDetailsError(401, err.message)
        }
      } else {
        throw err
      }
    }
    return result
  }

  #reqToMessage (req) {
    const fields = []
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      fields.push({ name: req.rawHeaders[i], value: req.rawHeaders[i + 1] })
    }
    return {
      kind: 'request',
      method: req.method,
      targetUri: req.app.locals.origin + req.originalUrl,
      requestTarget: req.originalUrl,
      fields
    }
  }

  async #resolveVerifier (useCache, domainBlocker, candidate, context) {
    if (await domainBlocker.isBlocked(candidate.parameters.keyid)) {
      throw new ProblemDetailsError(403, 'not allowed')
    }
    const ok = await this.#remoteKeyStorage.getPublicKey(
      candidate.parameters.keyid,
      useCache
    )
    if (!ok) {
      throw new ProblemDetailsError(401, 'Public key not found')
    }
    const publicKey = crypto.createPublicKey(ok.publicKeyPem)
    if (publicKey.asymmetricKeyType !== 'rsa') {
      throw new ProblemDetailsError(401, `Bad public key type: ${publicKey.asymmetricKeyType}`)
    }
    return {
      algorithm: 'rsa-v1_5-sha256',
      owner: ok.owner,
      async verify (data, signature) {
        const v = crypto.createVerify('sha256')
        v.update(data)
        return v.verify(publicKey, signature)
      }
    }
  }
}
