import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class PrincipalActorMismatchError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#principal-actor-mismatch`,
      title: 'Principal-actor mismatch',
      ...extra
    })
  }
}
