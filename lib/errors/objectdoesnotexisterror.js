import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class ObjectDoesNotExistError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#object-does-not-exist`,
      title: 'Object does not exist',
      ...extra
    })
  }
}
