import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class DuplicateDeliveryError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#duplicate-delivery`,
      title: 'Duplicate delivery',
      ...extra
    })
  }
}
