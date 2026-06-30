import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class NoApplicableAddresseesError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#no-applicable-addressees`,
      title: 'No applicable addressees',
      ...extra
    })
  }
}
