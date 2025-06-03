import createHttpError from 'http-errors'

export class HTTPSignatureAuthenticator {
  static #maxDateDiff = 5 * 60 * 1000 // 5 minutes
  #remoteKeyStorage = null
  #logger = null
  #digester = null
  #signer = null
  constructor (remoteKeyStorage, signer, digester, logger) {
    this.#remoteKeyStorage = remoteKeyStorage
    this.#signer = signer
    this.#digester = digester
    this.#logger = logger.child({ class: this.constructor.name })
  }

  async authenticate (req, res, next) {
    const signature = req.get('Signature')
    if (!signature) {
      // Just continue
      return next()
    }
    const date = req.get('Date')
    if (!date) {
      return next(createHttpError(400, 'No date provided'))
    }
    try {
      if (Math.abs(Date.parse(date) - Date.now()) >
        HTTPSignatureAuthenticator.#maxDateDiff) {
        return next(createHttpError(400, 'Time skew too large'))
      }
    } catch (err) {
      // for date parsing errors
      return next(err)
    }
    if (req.rawBodyText && req.rawBodyText.length > 0) {
      const digest = req.get('Digest')
      if (!digest) {
        return next(createHttpError(400, 'No digest provided'))
      }
      const calculated = await this.#digester.digest(req.rawBodyText)
      if (!this.#digester.equals(digest, calculated)) {
        this.#logger.debug(`calculated: ${calculated} digest: ${digest}`)
        return next(createHttpError(400, 'Digest mismatch'))
      }
    }
    const { method, headers } = req
    const originalUrl = req.originalUrl
    this.#logger.debug({ originalUrl }, 'original URL')
    try {
      const keyId = this.#signer.keyId(signature)
      const ok = await this.#remoteKeyStorage.getPublicKey(keyId)
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
        return next(createHttpError(401, 'Unauthorized'))
      }
    } catch (err) {
      return next(err)
    }
  }
}
