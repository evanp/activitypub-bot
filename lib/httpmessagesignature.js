import assert from 'node:assert'
import crypto from 'node:crypto'

export class HTTPMessageSignature {
  static #preferredAlgs = [
    'ecdsa-p384-sha384',
    'ecdsa-p256-sha256',
    'rsa-pss-sha512',
    'rsa-pss-sha256',
    'rsa-v1_5-sha256'
  ]

  #logger

  constructor (logger) {
    assert.ok(logger)
    assert.strictEqual(typeof logger, 'object')
    this.#logger = logger
  }

  keyId (signatureInput) {
    assert.ok(signatureInput)
    assert.strictEqual(typeof signatureInput, 'string')
    const inputs = this.#parseSignatureInput(signatureInput)
    const input = this.#bestInput(inputs)
    return (input)
      ? input.keyId
      : null
  }

  created (signatureInput) {
    assert.ok(signatureInput)
    assert.strictEqual(typeof signatureInput, 'string')
    const inputs = this.#parseSignatureInput(signatureInput)
    const input = this.#bestInput(inputs)
    return (input)
      ? input.created
      : null
  }

  async sign ({ privateKey, keyId, url, method, headers }) {
    const parsed = new URL(url)

    const signatureInput = []

    signatureInput.push(['@method', method])
    signatureInput.push(['@authority', parsed.hostname])
    signatureInput.push(['@path', parsed.pathname])
    if (parsed.search) {
      signatureInput.push(['@query', parsed.search])
    }

    for (const name in headers) {
      const lcname = name.toLowerCase()
      signatureInput.push([lcname, headers[name]])
    }

    const created = Math.floor(Date.now() / 1000)
    const componentList = signatureInput.map(([name]) => `"${name}"`).join(' ')
    const signatureParams = `(${componentList});keyId="${keyId}";alg="rsa-v1_5-sha256";created=${created}`

    signatureInput.push(['@signature-params', signatureParams])

    const data = signatureInput.map(pair => `"${pair[0]}": ${pair[1]}`).join('\n')

    const signer = crypto.createSign('sha256')
    signer.update(data)
    const signature = signer.sign(privateKey).toString('base64')
    signer.end()

    return {
      'signature-input': `sig1=${signatureParams}`,
      signature: `sig1=:${signature}:`
    }
  }

  async validate (publicKeyPem, signatureInput, signature, method, path, query, headers) {
    const inputs = this.#parseSignatureInput(signatureInput)
    const input = this.#bestInput(inputs)
    if (!input) {
      throw new Error('No input with supported algorithms')
    }
    const bytes = this.#sigBytes(signature, input.name)
    if (!bytes) {
      throw new Error('No input with supported algorithms')
    }
    const data = this.#inputData(input, method, path, query, headers)
    const verifier = this.#getVerifier(input.alg)
    verifier.update(data)
    const options = this.#getVerifierOptions(input.alg)
    return verifier.verify(publicKeyPem, bytes, options)
  }

  #parseSignatureInput (signatureInput) {
    const parts = signatureInput.split(',')
    const signatures = {}
    for (const part of parts) {
      const eq = part.indexOf('=')
      const name = part.slice(0, eq)
      const attrStr = part.slice(eq + 1)
      const attrs = attrStr.split(';')
      const paramStr = attrs.shift()
      const params = paramStr.slice(1, -1)
        .split(' ')
        .map(quoted => quoted.slice(1, -1))
      const sigvals = Object.fromEntries(
        attrs.map(keqv => {
          const eq = keqv.indexOf('=')
          const k = keqv.slice(0, eq)
          const v = keqv.slice(eq + 1)
          return [k, (v.match(/^\d+$/)) ? parseInt(v) : v.slice(1, -1)]
        })
      )
      signatures[name] = { name, params, attrStr, ...sigvals }
    }
    return signatures
  }

  #bestInput (inputs) {
    for (const alg of HTTPMessageSignature.#preferredAlgs) {
      const entry = Object.values(inputs).find(sig => sig.alg === alg)
      if (entry) {
        return entry
      }
    }
    return null
  }

  #inputData (input, method, path, query, headers) {
    const signatureParams = []
    for (const param of input.params) {
      let value
      switch (param) {
        case '@method':
          value = method.toUpperCase()
          break
        case '@authority':
          value = headers.host
          break
        case '@path':
          value = path
          break
        case '@query':
          value = query
          break
        default:
          value = headers[param]
      }
      signatureParams.push([param, value])
    }
    signatureParams.push(['@signature-params', input.attrStr])
    return signatureParams.map(pair => `"${pair[0]}": ${pair[1]}`).join('\n')
  }

  #getVerifier (alg) {
    switch (alg) {
      case 'ecdsa-p384-sha384':
        return crypto.createVerify('sha384')
      case 'ecdsa-p256-sha256':
        return crypto.createVerify('sha256')
      case 'rsa-pss-sha512':
        return crypto.createVerify('sha512')
      case 'rsa-pss-sha256':
        return crypto.createVerify('sha256')
      case 'rsa-v1_5-sha256':
        return crypto.createVerify('sha256')
    }
  }

  #getVerifierOptions (alg) {
    switch (alg) {
      case 'rsa-pss-sha512':
      case 'rsa-pss-sha256':
        return { padding: crypto.constants.RSA_PKCS1_PSS_PADDING }
      default:
        return { }
    }
  }

  #sigBytes (sigHeader, name) {
    const sigMatch = sigHeader.match(new RegExp(`${name}=:([^:]+):`))
    if (!sigMatch) return false
    return Buffer.from(sigMatch[1], 'base64')
  }
}
