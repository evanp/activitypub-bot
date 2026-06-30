import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class PrincipalNotAuthorizedError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(403, detail, {
      type: `${FEP_C180}#principal-not-authorized`,
      title: 'Principal not authorized',
      ...extra
    })
  }
}
