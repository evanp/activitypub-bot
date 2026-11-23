import assert from 'node:assert/strict'
import crypto from 'node:crypto'

export function assertRfc9421SignatureInput (signatureInput, keyId, components) {
  assert.equal(typeof signatureInput, 'string')
  const input = signatureInput.match(/^sig1=\(([^)]*)\)(;.*)$/)
  assert.ok(input)
  const actualComponents = Array.from(input[1].matchAll(/"([^"]+)"/g), match => match[1])
  assert.deepEqual([...actualComponents].sort(), [...components].sort())
  assert.ok(input[2].includes(`;keyid="${keyId}"`))
  assert.match(input[2], /;alg="rsa-v1_5-sha256"(?:;|$)/)
  assert.match(input[2], /;created=\d+(?:;|$)/)
  return actualComponents
}

export function assertRfc9421Signature ({ headers, keyId, components, method, url, publicKey }) {
  const actualComponents = assertRfc9421SignatureInput(headers['signature-input'], keyId, components)
  const signature = headers.signature.match(/^sig1=:([0-9A-Za-z+/=]+):$/)
  assert.ok(signature)
  const derived = { '@method': method, '@target-uri': url }
  const lines = actualComponents.map(name => {
    const value = name.startsWith('@') ? derived[name] : headers[name]
    assert.notEqual(value, undefined)
    return `"${name}": ${value}`
  })
  lines.push(`"@signature-params": ${headers['signature-input'].slice('sig1='.length)}`)
  assert.ok(crypto.verify('sha256', Buffer.from(lines.join('\n')), {
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_PADDING
  }, Buffer.from(signature[1], 'base64')))
}
