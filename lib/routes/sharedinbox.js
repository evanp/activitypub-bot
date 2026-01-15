import express from 'express'
import as2 from '../activitystreams.js'
import createHttpError from 'http-errors'

const router = express.Router()

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

  if (actor.id !== subject) {
    return next(createHttpError(403, `${subject} is not the actor ${actor.id}`))
  }

  await deliverer.deliverToAll(activity, bots)

  res.status(200)
  res.type('text/plain')
  res.send('OK')
})

export default router
