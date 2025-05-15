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
    this.#logger = logger
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
      if (Date.parse(date) - Date.now() > HTTPSignatureAuthenticator.#maxDateDiff) {
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
    const { method, path, headers } = req
    try {
      const keyId = this.#signer.keyId(signature)
      const { owner, publicKeyPem } =
        await this.#remoteKeyStorage.getPublicKey(keyId)
      if (await this.#signer.validate(publicKeyPem, signature, method, path, headers)) {
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
