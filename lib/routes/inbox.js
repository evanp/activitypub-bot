import http from 'node:http'

import express from 'express'
import createHttpError from 'http-errors'

import as2 from '../activitystreams.js'
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
    logger.warn({ err }, 'Failed to import activity')
    logger.debug({ body: req.body }, 'Request body')
    return next(createHttpError(400, 'Invalid request body'))
  }

  if (!activity.isActivity()) {
    return next(createHttpError(400, 'Request body is not an activity'))
  }

  const actor = deliverer.getActor(activity)

  if (!actor) {
    return next(createHttpError(400, 'No actor found in activity'))
  }

  if (!actor.id) {
    return next(createHttpError(400, 'No actor id found in activity'))
  }

  if (actor.id !== subject && !(await bot.actorOK(subject, activity))) {
    return next(createHttpError(403, `${subject} is not the actor ${actor.id}`))
  }

  if (await actorStorage.isInCollection(username, 'blocked', actor)) {
    return next(createHttpError(403, 'Forbidden'))
  }

  if (!activity.id) {
    return next(createHttpError(400, 'No activity id found in activity'))
  }

  if (await actorStorage.isInCollection(bot.username, 'inbox', activity)) {
    return next(createHttpError(400, 'Activity already delivered'))
  }

  logger.info(`Activity ${activity.id} received at ${bot.username} inbox`)

  await deliverer.deliverTo(activity, bot)

  if (deliverer.isPublic(activity)) {
    await deliverer.deliverPublic(activity, bots)
  }

  res.status(202)
  res.type('text/plain')
  res.send(http.STATUS_CODES[202])
})

router.get('/user/:username/inbox', async (req, res, next) => {
  return next(createHttpError(403, 'No access to inbox collection'))
})

router.get('/user/:username/inbox/:n', async (req, res, next) => {
  return next(createHttpError(403, 'No access to inbox collection'))
})

export default router
