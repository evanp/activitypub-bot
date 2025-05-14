import createHttpError from 'http-errors'
import crypto from 'node:crypto'

export class HTTPSignature {
  static #maxDateDiff = 5 * 60 * 1000 // 5 minutes
  #remoteKeyStorage = null
  #logger = null
  constructor (remoteKeyStorage, logger = null) {
    this.#remoteKeyStorage = remoteKeyStorage
    this.#logger = logger
  }

  async validate (signature, method, path, headers) {
    if (!signature) {
      throw createHttpError(401, 'No signature provided')
    }
    if (!method) {
      throw createHttpError(400, 'No HTTP method provided')
    }
    if (!path) {
      throw createHttpError(400, 'No URL path provided')
    }
    if (!headers) {
      throw createHttpError(400, 'No request headers provided')
    }
    const parts = signature.split(',')
    const params = {}
    for (const part of parts) {
      const [key, value] = part.split('=')
      params[key] = value.replace(/"/g, '')
    }
    const keyId = params.keyId
    if (!keyId) {
      throw createHttpError(401, 'No keyId provided')
    }
    this.debug(`keyId: ${keyId}`)
    const algorithm = params.algorithm
    if (!algorithm) {
      throw createHttpError(401, 'No algorithm provided')
    }
    this.debug(`algorithm: ${algorithm}`)
    if (algorithm !== 'rsa-sha256') {
      throw createHttpError(401, 'Only rsa-sha256 is supported')
    }
    if (!params.headers) {
      throw createHttpError(401, 'No headers provided')
    }
    const signedHeaders = params.headers.split(' ')
    this.debug(`signedHeaders: ${signedHeaders}`)
    const signatureString = params.signature
    if (!signatureString) {
      throw createHttpError(401, 'No signature field provided in signature header')
    }
    const signingString = signedHeaders.map(signedHeader => {
      if (signedHeader === '(request-target)') {
        return `(request-target): ${method.toLowerCase()} ${path}`
      }
      const value = headers[signedHeader]
      if (!value) {
        throw createHttpError(401, `Missing header: ${signedHeader}`)
      }
      return `${signedHeader}: ${headers[signedHeader]}`
    }).join('\n')
    this.debug(`signingString: ${signingString}`)
    const { publicKeyPem, owner } = await this.#remoteKeyStorage.getPublicKey(keyId)
    if (!publicKeyPem) {
      throw createHttpError(401, `Public key not found for ${keyId}`)
    }
    const verify = crypto.createVerify('sha256')
    verify.update(signingString)
    if (!verify.verify(publicKeyPem, signatureString, 'base64')) {
      throw createHttpError(401, 'Signature verification failed')
    }
    return owner
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
      if (Date.parse(date) - Date.now() > HTTPSignature.#maxDateDiff) {
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
      const calculated = await this.#digest(req.rawBodyText)
      if (!this.#equalDigest(digest, calculated)) {
        this.debug(`calculated: ${calculated} digest: ${digest}`)
        return next(createHttpError(400, 'Digest mismatch'))
      }
    }
    const { method, path, headers } = req
    let owner = null
    try {
      owner = await this.validate(signature, method, path, headers)
    } catch (err) {
      return next(err)
    }
    if (owner) {
      req.auth = req.auth || {}
      req.auth.subject = owner
      return next()
    } else {
      return next(createHttpError(401, 'Unauthorized'))
    }
  }

  debug (message) {
    if (this.#logger) {
      this.#logger.debug(message)
    }
  }

  async #digest (body) {
    const digest = crypto.createHash('sha256')
    digest.update(body)
    return `sha-256=${digest.digest('base64')}`
  }

  #equalDigest (digest1, digest2) {
    const [alg1, hash1] = digest1.split('=', 2)
    const [alg2, hash2] = digest2.split('=', 2)
    if (alg1.toLowerCase() !== alg2.toLowerCase()) {
      return false
    }
    return hash1 === hash2
  }
}
