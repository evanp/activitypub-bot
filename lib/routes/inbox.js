import express from 'express'
import as2 from '../activitystreams.js'
import createHttpError from 'http-errors'
import BotMaker from '../botmaker.js'

const router = express.Router()

router.post('/user/:username/inbox', async (req, res, next) => {
  const { username } = req.params
  const { bots, deliverer, actorStorage } = req.app.locals
  const { subject } = req.auth
  const { logger } = req.app.locals

  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(createHttpError(404, `User ${username} not found`))
  }

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

  if (await actorStorage.isInCollection(username, 'blocked', actor)) {
    return next(createHttpError(403, 'Forbidden'))
  }

  if (await actorStorage.isInCollection(bot.username, 'inbox', activity)) {
    return next(createHttpError(400, 'Activity already delivered'))
  }

  await deliverer.deliverTo(activity, bot)

  res.status(200)
  res.type('text/plain')
  res.send('OK')
})

export default router
