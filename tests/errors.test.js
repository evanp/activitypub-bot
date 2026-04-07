import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  ProblemDetailsError,
  UnsupportedTypeError,
  ObjectDoesNotExistError,
  DuplicateDeliveryError,
  RedundantActivityError,
  ApprovalRequiredError,
  NotAnActorError,
  PrincipalActorMismatchError,
  ActorNotAuthorizedError,
  PrincipalNotAuthorizedError,
  ClientNotAuthorizedError,
  UnsupportedMediaTypeError,
  MediaTooLargeError,
  NoApplicableAddresseesError,
  RateLimitExceededError
} from '../lib/errors.js'

const FEP_C180 = 'https://w3id.org/fep/c180'

describe('ProblemDetailsError', () => {
  it('is an instance of Error', () => {
    const err = new ProblemDetailsError(400, 'Bad thing happened')
    assert.ok(err instanceof Error)
  })
  it('sets status', () => {
    const err = new ProblemDetailsError(404, 'Not found')
    assert.strictEqual(err.status, 404)
  })
  it('sets message from detail', () => {
    const err = new ProblemDetailsError(400, 'Something went wrong')
    assert.strictEqual(err.message, 'Something went wrong')
  })
  it('defaults type to about:blank', () => {
    const err = new ProblemDetailsError(400, 'Bad thing happened')
    assert.strictEqual(err.type, 'about:blank')
  })
  it('defaults title from HTTP status code', () => {
    const err = new ProblemDetailsError(400, 'Bad thing happened')
    assert.strictEqual(err.title, 'Bad Request')
  })
  it('accepts a custom type via extra', () => {
    const err = new ProblemDetailsError(400, 'Bad thing happened', { type: 'https://example.com/probs/bad' })
    assert.strictEqual(err.type, 'https://example.com/probs/bad')
  })
  it('accepts a custom title via extra', () => {
    const err = new ProblemDetailsError(400, 'Bad thing happened', { title: 'Custom title' })
    assert.strictEqual(err.title, 'Custom title')
  })
  it('spreads extra fields onto the instance', () => {
    const err = new ProblemDetailsError(400, 'Bad thing happened', { id: 'https://example.com/obj/1' })
    assert.strictEqual(err.id, 'https://example.com/obj/1')
  })
})

describe('UnsupportedTypeError', () => {
  it('is an instance of ProblemDetailsError', () => {
    const err = new UnsupportedTypeError('Unsupported type received')
    assert.ok(err instanceof ProblemDetailsError)
  })
  it('has status 400', () => {
    const err = new UnsupportedTypeError('Unsupported type received')
    assert.strictEqual(err.status, 400)
  })
  it('has the correct FEP-c180 type URI', () => {
    const err = new UnsupportedTypeError('Unsupported type received')
    assert.strictEqual(err.type, `${FEP_C180}#unsupported-type`)
  })
  it('sets objectType from extra type field', () => {
    const err = new UnsupportedTypeError('Not an activity', { type: 'Note', id: 'https://example.com/1' })
    assert.strictEqual(err.objectType, 'Note')
    assert.strictEqual(err.id, 'https://example.com/1')
  })
})

describe('ObjectDoesNotExistError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new ObjectDoesNotExistError('Missing') instanceof ProblemDetailsError)
  })
  it('has status 400', () => {
    assert.strictEqual(new ObjectDoesNotExistError('Missing').status, 400)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new ObjectDoesNotExistError('Missing').type, `${FEP_C180}#object-does-not-exist`)
  })
  it('sets id from extra', () => {
    const err = new ObjectDoesNotExistError('Missing', { id: 'https://example.com/1' })
    assert.strictEqual(err.id, 'https://example.com/1')
  })
})

describe('DuplicateDeliveryError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new DuplicateDeliveryError('Already delivered') instanceof ProblemDetailsError)
  })
  it('has status 400', () => {
    assert.strictEqual(new DuplicateDeliveryError('Already delivered').status, 400)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new DuplicateDeliveryError('Already delivered').type, `${FEP_C180}#duplicate-delivery`)
  })
  it('sets id from extra', () => {
    const err = new DuplicateDeliveryError('Already delivered', { id: 'https://example.com/activity/1' })
    assert.strictEqual(err.id, 'https://example.com/activity/1')
  })
})

describe('RedundantActivityError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new RedundantActivityError('Redundant') instanceof ProblemDetailsError)
  })
  it('has status 400', () => {
    assert.strictEqual(new RedundantActivityError('Redundant').status, 400)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new RedundantActivityError('Redundant').type, `${FEP_C180}#redundant-activity`)
  })
  it('sets duplicate from extra', () => {
    const err = new RedundantActivityError('Redundant', { duplicate: 'https://example.com/activity/1' })
    assert.strictEqual(err.duplicate, 'https://example.com/activity/1')
  })
})

describe('ApprovalRequiredError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new ApprovalRequiredError('Needs approval') instanceof ProblemDetailsError)
  })
  it('has status 202', () => {
    assert.strictEqual(new ApprovalRequiredError('Needs approval').status, 202)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new ApprovalRequiredError('Needs approval').type, `${FEP_C180}#approval-required`)
  })
  it('sets approver from extra', () => {
    const err = new ApprovalRequiredError('Needs approval', { approver: 'https://example.com/actors/admin' })
    assert.strictEqual(err.approver, 'https://example.com/actors/admin')
  })
})

describe('NotAnActorError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new NotAnActorError('Not an actor') instanceof ProblemDetailsError)
  })
  it('has status 400', () => {
    assert.strictEqual(new NotAnActorError('Not an actor').status, 400)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new NotAnActorError('Not an actor').type, `${FEP_C180}#not-an-actor`)
  })
  it('sets id from extra', () => {
    const err = new NotAnActorError('Not an actor', { id: 'https://example.com/1' })
    assert.strictEqual(err.id, 'https://example.com/1')
  })
})

describe('PrincipalActorMismatchError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new PrincipalActorMismatchError('Mismatch') instanceof ProblemDetailsError)
  })
  it('has status 400', () => {
    assert.strictEqual(new PrincipalActorMismatchError('Mismatch').status, 400)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new PrincipalActorMismatchError('Mismatch').type, `${FEP_C180}#principal-actor-mismatch`)
  })
  it('sets principal and actor from extra', () => {
    const err = new PrincipalActorMismatchError('Mismatch', {
      principal: 'https://example.com/actors/alice',
      actor: 'https://example.com/actors/bob'
    })
    assert.strictEqual(err.principal, 'https://example.com/actors/alice')
    assert.strictEqual(err.actor, 'https://example.com/actors/bob')
  })
})

describe('ActorNotAuthorizedError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new ActorNotAuthorizedError('Not authorized') instanceof ProblemDetailsError)
  })
  it('has status 403', () => {
    assert.strictEqual(new ActorNotAuthorizedError('Not authorized').status, 403)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new ActorNotAuthorizedError('Not authorized').type, `${FEP_C180}#actor-not-authorized`)
  })
  it('sets actor and resource from extra', () => {
    const err = new ActorNotAuthorizedError('Not authorized', {
      actor: 'https://example.com/actors/alice',
      resource: 'https://example.com/notes/1'
    })
    assert.strictEqual(err.actor, 'https://example.com/actors/alice')
    assert.strictEqual(err.resource, 'https://example.com/notes/1')
  })
})

describe('PrincipalNotAuthorizedError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new PrincipalNotAuthorizedError('Not authorized') instanceof ProblemDetailsError)
  })
  it('has status 403', () => {
    assert.strictEqual(new PrincipalNotAuthorizedError('Not authorized').status, 403)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new PrincipalNotAuthorizedError('Not authorized').type, `${FEP_C180}#principal-not-authorized`)
  })
  it('sets principal and resource from extra', () => {
    const err = new PrincipalNotAuthorizedError('Not authorized', {
      principal: 'https://example.com/actors/alice',
      resource: 'https://example.com/notes/1'
    })
    assert.strictEqual(err.principal, 'https://example.com/actors/alice')
    assert.strictEqual(err.resource, 'https://example.com/notes/1')
  })
})

describe('ClientNotAuthorizedError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new ClientNotAuthorizedError('Not authorized') instanceof ProblemDetailsError)
  })
  it('has status 403', () => {
    assert.strictEqual(new ClientNotAuthorizedError('Not authorized').status, 403)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new ClientNotAuthorizedError('Not authorized').type, `${FEP_C180}#client-not-authorized`)
  })
  it('sets client from extra', () => {
    const err = new ClientNotAuthorizedError('Not authorized', { client: 'https://example.com/clients/app1' })
    assert.strictEqual(err.client, 'https://example.com/clients/app1')
  })
})

describe('UnsupportedMediaTypeError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new UnsupportedMediaTypeError('Bad media type') instanceof ProblemDetailsError)
  })
  it('has status 400', () => {
    assert.strictEqual(new UnsupportedMediaTypeError('Bad media type').status, 400)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new UnsupportedMediaTypeError('Bad media type').type, `${FEP_C180}#unsupported-media-type`)
  })
  it('sets filename and mediaType from extra', () => {
    const err = new UnsupportedMediaTypeError('Bad media type', { filename: 'photo.bmp', mediaType: 'image/bmp' })
    assert.strictEqual(err.filename, 'photo.bmp')
    assert.strictEqual(err.mediaType, 'image/bmp')
  })
})

describe('MediaTooLargeError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new MediaTooLargeError('File too large') instanceof ProblemDetailsError)
  })
  it('has status 413', () => {
    assert.strictEqual(new MediaTooLargeError('File too large').status, 413)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new MediaTooLargeError('File too large').type, `${FEP_C180}#media-too-large`)
  })
  it('sets filename, size, maxSize from extra', () => {
    const err = new MediaTooLargeError('File too large', { filename: 'video.mp4', size: 1000000, maxSize: 500000 })
    assert.strictEqual(err.filename, 'video.mp4')
    assert.strictEqual(err.size, 1000000)
    assert.strictEqual(err.maxSize, 500000)
  })
})

describe('NoApplicableAddresseesError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new NoApplicableAddresseesError('No addressees') instanceof ProblemDetailsError)
  })
  it('has status 400', () => {
    assert.strictEqual(new NoApplicableAddresseesError('No addressees').status, 400)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new NoApplicableAddresseesError('No addressees').type, `${FEP_C180}#no-applicable-addressees`)
  })
})

describe('RateLimitExceededError', () => {
  it('is an instance of ProblemDetailsError', () => {
    assert.ok(new RateLimitExceededError('Rate limited') instanceof ProblemDetailsError)
  })
  it('has status 429', () => {
    assert.strictEqual(new RateLimitExceededError('Rate limited').status, 429)
  })
  it('has the correct FEP-c180 type URI', () => {
    assert.strictEqual(new RateLimitExceededError('Rate limited').type, `${FEP_C180}#rate-limit-exceeded`)
  })
})
