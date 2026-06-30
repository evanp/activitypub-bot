function normalizeHeaders (headers) {
  if (!headers) {
    return headers
  }
  if (typeof headers.forEach === 'function') {
    const result = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
  return headers
}

export class ActivityPubClientError extends Error {
  constructor (status, message, { url, method, headers, body } = {}) {
    super(message)
    this.name = 'ActivityPubClientError'
    this.status = status
    this.url = url
    this.method = method
    this.headers = normalizeHeaders(headers)
    this.body = body
  }
}
