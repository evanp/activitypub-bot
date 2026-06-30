import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class UnsupportedMediaTypeError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#unsupported-media-type`,
      title: 'Unsupported media type',
      ...extra
    })
  }
}
