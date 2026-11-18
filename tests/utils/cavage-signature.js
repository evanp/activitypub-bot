import crypto from 'node:crypto'

export function signCavage (privateKey, signingString, parameters) {
  const signature = crypto.sign('sha256', Buffer.from(signingString), privateKey).toString('base64')
  return `${parameters},signature="${signature}"`
}
