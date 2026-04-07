import http from 'node:http'

import express from 'express'

import as2 from '../activitystreams.js'
import {
  ProblemDetailsError,
  UnsupportedTypeError,
  PrincipalActorMismatchError
} from '../errors.js'

const router = express.Router()

async function asyncSome (array, asyncPredicate) {
  for (let i = 0; i < array.length; i++) {
    if (await asyncPredicate(array[i], i, array)) {
      return true
    }
  }
  return false
}

async function actorOK (subject, activity, bots) {
  return await asyncSome(
    Object.values(bots),
    bot => bot.actorOK(subject, activity)
  )
}

router.post('/shared/inbox', async (req, res, next) => {
  const { bots, deliverer, logger } = req.app.locals
  const { subject } = req.auth

  if (!subject) {
    return next(new ProblemDetailsError(401, 'Unauthorized'))
  }

  if (!req.body) {
    return next(new ProblemDetailsError(400, 'No request body provided'))
  }

  let activity

  try {
    activity = await as2.import(req.body)
  } catch (err) {
    logger.warn({ reqId: req.id, err }, 'Failed to import activity')
    logger.debug({ reqId: req.id, body: req.body }, 'Request body')
    return next(new ProblemDetailsError(400, 'Invalid request body'))
  }

  if (!activity.isActivity()) {
    return next(new UnsupportedTypeError('Request body is not an activity', { objectType: activity.type }))
  }

  const actor = deliverer.getActor(activity)

  if (!actor) {
    return next(new ProblemDetailsError(400, 'No actor found in activity'))
  }

  if (!actor.id) {
    return next(new ProblemDetailsError(400, 'No actor id found in activity'))
  }

  if (actor.id !== subject && !(await actorOK(subject, activity, bots))) {
    return next(new PrincipalActorMismatchError(`${subject} is not the actor ${actor.id}`, { principal: subject, actor: actor.id }))
  }

  if (!activity.id) {
    return next(new ProblemDetailsError(400, 'No activity id found in activity'))
  }

  logger.info(
    { reqId: req.id, activity: activity.id },
    'Activity received at shared inbox'
  )

  await deliverer.intake(activity, subject)

  res.status(202)
  res.type('text/plain')
  res.send(http.STATUS_CODES[201])
})

export default router
