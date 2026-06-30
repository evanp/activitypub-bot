import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class RateLimitExceededError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(429, detail, {
      type: `${FEP_C180}#rate-limit-exceeded`,
      title: 'Rate limit exceeded',
      ...extra
    })
  }
}
