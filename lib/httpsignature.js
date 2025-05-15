import createHttpError from 'http-errors'
import crypto from 'node:crypto'

export class HTTPSignature {
  static #maxDateDiff = 5 * 60 * 1000 // 5 minutes
  #logger = null
  constructor (logger) {
    this.#logger = logger
  }

  keyId (signature) {
    const params = this.#parseSignatureHeader(signature)
    if (!params.keyId) {
      throw createHttpError(401, 'No keyId provided')
    }
    return params.keyId
  }

  async validate (publicKeyPem, signature, method, path, headers) {
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

    const params = this.#parseSignatureHeader(signature)

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

    const signingString = this.#signingString({
      method,
      target: path,
      host: headers.host,
      headers,
      headersList: signedHeaders
    })

    this.debug(`signingString: ${signingString}`)

    return this.#verify(publicKeyPem, signingString, signatureString)
  }

  async sign ({ privateKey, keyId, url, method, headers }) {
    const algorithm = 'rsa-sha256'
    const headersList = ['(request-target)', 'host', 'date']

    if (headers.digest) {
      headersList.push('digest')
    }

    const parsed = new URL(url)
    const target = (parsed.search && parsed.search.length)
      ? `${parsed.pathname}?${parsed.search}`
      : `${parsed.pathname}`
    const host = parsed.host

    const signingString = this.#signingString({
      method,
      host,
      target,
      headers,
      headersList
    })

    const signature = await this.#signWithKey({
      privateKey,
      signingString,
      algorithm
    })

    return this.#signatureHeader({ keyId, headersList, signature, algorithm })
  }

  debug (message) {
    if (this.#logger) {
      this.#logger.debug(message)
    }
  }

  #signWithKey ({ privateKey, signingString, algorithm }) {
    if (algorithm !== 'rsa-sha256') {
      throw new Error('Only rsa-sha256 is supported')
    }
    const signer = crypto.createSign('sha256')
    signer.update(signingString)
    const signature = signer.sign(privateKey).toString('base64')
    signer.end()

    return signature
  }

  #signingString ({ method, host, target, headers, headersList }) {
    const lines = []
    for (const headerName of headersList) {
      if (headerName === '(request-target)') {
        lines.push(`(request-target): ${method.toLowerCase()} ${target}`)
      } else if (headerName === 'host') {
        lines.push(`host: ${host}`)
      } else if (headerName in headers) {
        lines.push(`${headerName}: ${headers[headerName]}`)
      }
    }

    return lines.join('\n')
  }

  #signatureHeader ({ keyId, headersList, signature, algorithm }) {
    const parts = []
    parts.push(`keyId="${keyId}"`)
    if (headersList.length > 0) {
      parts.push(`headers="${headersList.join(' ')}"`)
    }
    parts.push(`signature="${signature.replace(/"/g, '\\"')}"`)
    parts.push(`algorithm="${algorithm}"`)
    return parts.join(',')
  }

  #parseSignatureHeader (signature) {
    const parts = signature.split(',')
    const params = {}
    for (const part of parts) {
      const [key, value] = part.split('=')
      params[key] = value.replace(/"/g, '')
    }
    return params
  }

  #verify (publicKeyPem, signingString, signature) {
    const verifier = crypto.createVerify('sha256')
    verifier.update(signingString)
    const isValid = verifier.verify(publicKeyPem, signature, 'base64')
    verifier.end()
    return isValid
  }
}
