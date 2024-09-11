import crypto from 'node:crypto'

export function makeDigest (body) {
  const digest = crypto.createHash('sha256')
  digest.update(body)
  return `SHA-256=${digest.digest('base64')}`
}
