import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class ClientNotAuthorizedError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(403, detail, {
      type: `${FEP_C180}#client-not-authorized`,
      title: 'Client not authorized',
      ...extra
    })
  }
}
