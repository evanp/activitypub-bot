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
      ? input.keyid
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
    this.#logger.debug({ privateKey, keyId, url, method, headers }, 'signing')

    const parsed = new URL(url)

    const signatureInput = []

    signatureInput.push(['@method', method.toUpperCase()])
    signatureInput.push(['@authority', parsed.host])
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
    const signatureParams = `(${componentList});keyid="${keyId}";alg="rsa-v1_5-sha256";created=${created}`

    signatureInput.push(['@signature-params', signatureParams])

    this.#logger.debug({ signatureInput }, 'built data structure')

    const data = signatureInput.map(pair => `"${pair[0]}": ${pair[1]}`).join('\n')

    this.#logger.debug({ data }, 'data')

    const signer = crypto.createSign('sha256')
    signer.update(data)
    const signature = signer.sign(privateKey).toString('base64')
    signer.end()

    const result = {
      'signature-input': `sig1=${signatureParams}`,
      signature: `sig1=:${signature}:`
    }

    this.#logger.debug({ result }, 'returning headers')

    return result
  }

  async validate (publicKeyPem, signatureInput, signature, method, url, headers) {
    this.#logger.debug(
      { publicKeyPem, signatureInput, signature, method, url, headers }, 'validating signature'
    )
    const inputs = this.#parseSignatureInput(signatureInput)
    this.#logger.debug(
      { inputs }, 'validating signature'
    )
    const input = this.#bestInput(inputs)
    if (!input) {
      throw new Error('No input with supported algorithms')
    }
    this.#logger.debug(
      { input }, 'best input'
    )
    const bytes = this.#sigBytes(signature, input.name)
    if (!bytes) {
      throw new Error('No input with supported algorithms')
    }
    const data = this.#inputData(input, method, url, headers)
    this.#logger.debug(
      { data }, 'input data'
    )
    const verifier = this.#getVerifier(input.alg)
    verifier.update(data)
    const options = this.#getVerifierOptions(input.alg)
    return verifier.verify(publicKeyPem, bytes, options)
  }

  #parseSignatureInput (signatureInput) {
    const SIG_RE = /(\w+)=(\([^)]*\))((?:;[^,]*)*)/g
    const PARAM_RE = /;(\w+)=("(?:[^"\\]|\\.)*"|\d+)/g
    const signatures = {}
    for (const match of signatureInput.matchAll(SIG_RE)) {
      const name = match[1]
      const attrStr = `${match[2]}${match[3]}`
      const params = match[2].slice(1, -1)
        .split(' ')
        .filter(s => s.length > 0)
        .map(token => {
          const m = token.match(/^"([^"]+)"(.*)$/)
          if (!m) return token
          return m[2] ? `${m[1]}${m[2]}` : m[1]
        })
      const sigvals = {}
      for (const paramMatch of match[3].matchAll(PARAM_RE)) {
        const k = paramMatch[1]
        const v = paramMatch[2]
        sigvals[k] = v.match(/^\d+$/) ? parseInt(v) : v.slice(1, -1)
      }
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

  #inputData (input, method, url, headers) {
    const signatureParams = []
    const parsed = URL.parse(url)
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
          value = parsed.pathname
          break
        case '@query':
          value = parsed.search
          break
        case '@target-uri':
          value = url
          break
        case '@scheme':
          value = parsed.protocol.slice(0, -1)
          break
        case '@request-target':
          value = (parsed.search)
            ? `${parsed.pathname}${parsed.search}`
            : parsed.pathname
          break
        default:
          if (param.startsWith('@query-param')) {
            const nameMatch = param.match(/;name="([^"]+)"/)
            if (!nameMatch) throw new Error('Missing name for @query-param')
            const paramName = nameMatch[1]
            signatureParams.push(['@query-param', parsed.searchParams.get(paramName), `name="${paramName}"`])
            continue
          }
          if (param.length > 0 && param[0] === '@') {
            throw new Error(`Unrecognized derived component ${param}`)
          }
          value = headers[param]
      }
      signatureParams.push([param, value])
    }
    signatureParams.push(['@signature-params', input.attrStr])
    return signatureParams.map(
      arr => arr.length === 3
        ? `"${arr[0]}";${arr[2]}: ${arr[1]}`
        : `"${arr[0]}": ${arr[1]}`
    ).join('\n')
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
