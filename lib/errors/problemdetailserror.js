import http from 'node:http'

export class ProblemDetailsError extends Error {
  constructor (status, detail, extra = {}) {
    super(detail)
    this.status = status
    const { type, title, ...rest } = extra
    this.type = type || 'about:blank'
    this.title = title || http.STATUS_CODES[status] || 'Unknown Status'
    this.detail = detail
    Object.assign(this, rest)
  }
}
