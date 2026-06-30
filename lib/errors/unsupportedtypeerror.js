import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class UnsupportedTypeError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    // Rename `type` to `objectType` to avoid conflict with the problem type URI field
    const { type: objectType, ...rest } = extra
    super(400, detail, {
      type: `${FEP_C180}#unsupported-type`,
      title: 'Unsupported type',
      ...rest,
      ...(objectType != null ? { objectType } : {})
    })
  }
}
