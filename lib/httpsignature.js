import createHttpError from 'http-errors'
import crypto from 'node:crypto'
import assert from 'node:assert'

export class HTTPSignature {
  static #maxDateDiff = 5 * 60 * 1000 // 5 minutes
  #logger = null
  constructor (logger) {
    this.#logger = logger.child({ class: this.constructor.name })
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
    this.#logger.debug({ keyId }, 'validating signature')
    const algorithm = params.algorithm
    if (!algorithm) {
      throw createHttpError(401, 'No algorithm provided')
    }
    this.#logger.debug({ algorithm }, 'validating signature')
    if (algorithm !== 'rsa-sha256') {
      throw createHttpError(401, 'Only rsa-sha256 is supported')
    }
    if (!params.headers) {
      throw createHttpError(401, 'No headers provided')
    }
    const signedHeaders = params.headers.split(' ')
    this.#logger.debug({ signedHeaders }, 'validating signature')
    const signatureString = params.signature
    if (!signatureString) {
      throw createHttpError(401, 'No signature field provided in signature header')
    }
    this.#logger.debug({ signatureString }, 'validating signature')
    const signingString = this.#signingString({
      method,
      target: path,
      host: headers.host,
      headers,
      headersList: signedHeaders
    })
    this.#logger.debug({ signingString }, 'validating signature')
    return this.#verify(publicKeyPem, signingString, signatureString)
  }

  async sign ({ privateKey, keyId, url, method, headers }) {
    assert.ok(privateKey)
    assert.equal(typeof privateKey, 'string')
    assert.ok(keyId)
    assert.equal(typeof keyId, 'string')
    assert.ok(url)
    assert.equal(typeof url, 'string')
    assert.ok(method)
    assert.equal(typeof method, 'string')
    assert.ok(headers)
    assert.equal(typeof headers, 'object')

    this.#logger.debug({ keyId, url, method, headers }, 'signing a request')

    const algorithm = 'rsa-sha256'
    const headersList = (method === 'POST')
      ? ['(request-target)', 'host', 'date', 'user-agent', 'content-type', 'digest']
      : ['(request-target)', 'host', 'date', 'user-agent', 'accept']

    this.#logger.debug({ algorithm, headersList }, 'signing a request')

    const parsed = new URL(url)
    const target = (parsed.search && parsed.search.length)
      ? `${parsed.pathname}?${parsed.search}`
      : `${parsed.pathname}`
    const host = parsed.host

    this.#logger.debug({ parsed, target, host }, 'signing a request')

    const signingString = this.#signingString({
      method,
      host,
      target,
      headers,
      headersList
    })

    this.#logger.debug({ signingString }, 'signing a request')

    const signature = this.#signWithKey({
      privateKey,
      signingString,
      algorithm
    })

    this.#logger.debug({ signature }, 'signed a request')

    const signatureHeader = this.#signatureHeader({ keyId, headersList, signature, algorithm })

    this.#logger.debug({ signatureHeader }, 'signed a request')
    return signatureHeader
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
    const canon = {}
    for (const key in headers) {
      canon[key.toLowerCase()] = headers[key]
    }
    for (const headerName of headersList) {
      if (headerName === '(request-target)') {
        lines.push(`(request-target): ${method.toLowerCase()} ${target.trim()}`)
      } else if (headerName === 'host') {
        lines.push(`host: ${host.trim()}`)
      } else if (headerName in canon) {
        assert.ok(typeof canon[headerName] === 'string', `Header ${headerName} is not a string: ${canon[headerName]}`)
        lines.push(`${headerName}: ${canon[headerName].trim()}`)
      } else {
        throw new Error(`Missing header: ${headerName}`)
      }
    }

    return lines.join('\n')
  }

  #signatureHeader ({ keyId, headersList, signature, algorithm }) {
    const components = {
      keyId,
      headers: headersList.join(' '),
      signature,
      algorithm
    }
    const properties = ['keyId', 'headers', 'signature', 'algorithm']

    const pairs = []
    for (const prop of properties) {
      pairs.push(`${prop}="${this.#escape(components[prop])}"`)
    }

    return pairs.join(',')
  }

  #escape (value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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
