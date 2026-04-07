import http from 'node:http'

const FEP_C180 = 'https://w3id.org/fep/c180'

export class ProblemDetailsError extends Error {
  constructor (status, detail, extra = {}) {
    super(detail)
    this.status = status
    const { type, title, ...rest } = extra
    this.type = type || 'about:blank'
    this.title = title || http.STATUS_CODES[status] || 'Unknown Status'
    this.detail = detail
    Object.assign(this, rest)
  }
}

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

export class ObjectDoesNotExistError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#object-does-not-exist`,
      title: 'Object does not exist',
      ...extra
    })
  }
}

export class DuplicateDeliveryError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#duplicate-delivery`,
      title: 'Duplicate delivery',
      ...extra
    })
  }
}

export class RedundantActivityError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#redundant-activity`,
      title: 'Redundant activity',
      ...extra
    })
  }
}

export class ApprovalRequiredError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(202, detail, {
      type: `${FEP_C180}#approval-required`,
      title: 'Approval required',
      ...extra
    })
  }
}

export class NotAnActorError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#not-an-actor`,
      title: 'Not an actor',
      ...extra
    })
  }
}

export class PrincipalActorMismatchError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#principal-actor-mismatch`,
      title: 'Principal-actor mismatch',
      ...extra
    })
  }
}

export class ActorNotAuthorizedError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(403, detail, {
      type: `${FEP_C180}#actor-not-authorized`,
      title: 'Actor not authorized',
      ...extra
    })
  }
}

export class PrincipalNotAuthorizedError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(403, detail, {
      type: `${FEP_C180}#principal-not-authorized`,
      title: 'Principal not authorized',
      ...extra
    })
  }
}

export class ClientNotAuthorizedError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(403, detail, {
      type: `${FEP_C180}#client-not-authorized`,
      title: 'Client not authorized',
      ...extra
    })
  }
}

export class UnsupportedMediaTypeError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#unsupported-media-type`,
      title: 'Unsupported media type',
      ...extra
    })
  }
}

export class MediaTooLargeError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(413, detail, {
      type: `${FEP_C180}#media-too-large`,
      title: 'Media too large',
      ...extra
    })
  }
}

export class NoApplicableAddresseesError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(400, detail, {
      type: `${FEP_C180}#no-applicable-addressees`,
      title: 'No applicable addressees',
      ...extra
    })
  }
}

export class RateLimitExceededError extends ProblemDetailsError {
  constructor (detail, extra = {}) {
    super(429, detail, {
      type: `${FEP_C180}#rate-limit-exceeded`,
      title: 'Rate limit exceeded',
      ...extra
    })
  }
}
