import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class ApprovalRequiredError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(202, detail, {
      type: `${FEP_C180}#approval-required`,
      title: 'Approval required',
      ...extra
    })
  }
}
