import { ProblemDetailsError } from './problemdetailserror.js'
import { FEP_C180 } from './constants.js'

export class MediaTooLargeError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(413, detail, {
      type: `${FEP_C180}#media-too-large`,
      title: 'Media too large',
      ...extra
    })
  }
}
