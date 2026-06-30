export class PrivateNetworkError extends Error {
  constructor (address) {
    super(`Private network address ${address}`)
    this.name = 'PrivateNetworkError'
    this.address = address
  }
}
