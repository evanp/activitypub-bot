import createHttpError from 'http-errors'
import crypto from 'node:crypto'

export class HTTPSignature {
  #remoteKeyStorage = null
  #logger = null
  constructor (remoteKeyStorage, logger = null) {
    this.#remoteKeyStorage = remoteKeyStorage
    this.#logger = logger
  }

  async validate (signature, method, path, headers) {
    const parts = signature.split(',')
    const params = {}
    for (const part of parts) {
      const [key, value] = part.split('=')
      params[key] = value.replace(/"/g, '')
    }
    this.debug(`Signature params: ${JSON.stringify(params)}`)
    const keyId = params.keyId
    const algorithm = params.algorithm
    if (algorithm !== 'rsa-sha256') {
      throw createHttpError(401, 'Unauthorized')
    }
    const signedHeaders = params.headers.split(' ')
    const signatureString = params.signature
    const signingString = signedHeaders.map(signedHeader => {
      if (signedHeader === '(request-target)') {
        return `(request-target): ${method.toLowerCase()} ${path}`
      }
      return `${signedHeader}: ${headers[signedHeader]}`
    }).join('\n')
    const { publicKeyPem, owner } = await this.#remoteKeyStorage.getPublicKey(keyId)
    if (!publicKeyPem) {
      throw createHttpError(401, 'Unauthorized')
    }
    const verify = crypto.createVerify('sha256')
    verify.update(signingString)
    if (!verify.verify(publicKeyPem, signatureString, 'base64')) {
      throw createHttpError(401, 'Unauthorized')
    }
    return owner
  }

  async authenticate (req, res, next) {
    const signature = req.get('Signature')
    if (!signature) {
      // Just continue
      return next()
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
}
