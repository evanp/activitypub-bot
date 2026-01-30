import express from 'express'
import as2 from '../activitystreams.js'
import createHttpError from 'http-errors'
import http from 'node:http'

const router = express.Router()

async function asyncSome(array, asyncPredicate) {
  for (let i = 0; i < array.length; i++) {
    if (await asyncPredicate(array[i], i, array)) {
      return true;
    }
  }
  return false;
}

async function actorOK (subject, activity, bots) {
  await asyncSome(Object.values(bots), bot => bot.actorOK(subject, activity))
}

router.post('/shared/inbox', async (req, res, next) => {
  const { bots, deliverer, logger } = req.app.locals
  const { subject } = req.auth

  if (!subject) {
    return next(createHttpError(401, 'Unauthorized'))
  }

  if (!req.body) {
    return next(createHttpError(400, 'No request body provided'))
  }

  let activity

  try {
    activity = await as2.import(req.body)
  } catch (err) {
    logger.warn('Failed to import activity', err)
    logger.debug('Request body', req.body)
    return next(createHttpError(400, 'Invalid request body'))
  }

  if (!deliverer.isActivity(activity)) {
    return next(createHttpError(400, 'Request body is not an activity'))
  }

  const actor = deliverer.getActor(activity)

  if (!actor) {
    return next(createHttpError(400, 'No actor found in activity'))
  }

  if (!actor.id) {
    return next(createHttpError(400, 'No actor id found in activity'))
  }

  if (actor.id !== subject && !(await actorOK(subject, activity, bots))) {
    return next(createHttpError(403, `${subject} is not the actor ${actor.id}`))
  }

  logger.info(`Activity ${activity.id} received at shared inbox`)

  await deliverer.deliverToAll(activity, bots)

  res.status(202)
  res.type('text/plain')
  res.send(http.STATUS_CODES[201])
})

export default router
