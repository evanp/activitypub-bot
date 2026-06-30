import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class ActorNotAuthorizedError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(403, detail, {
      type: `${FEP_C180}#actor-not-authorized`,
      title: 'Actor not authorized',
      ...extra
    })
  }
}
