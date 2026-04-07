import http from 'node:http'

import express from 'express'

import as2 from '../activitystreams.js'
import BotMaker from '../botmaker.js'
import {
  ProblemDetailsError,
  UnsupportedTypeError,
  DuplicateDeliveryError,
  PrincipalActorMismatchError,
  ActorNotAuthorizedError,
  PrincipalNotAuthorizedError
} from '../errors.js'

const router = express.Router()

router.post('/user/:username/inbox', async (req, res, next) => {
  const { username } = req.params
  const { bots, deliverer, actorStorage } = req.app.locals
  const { subject } = req.auth
  const { logger } = req.app.locals

  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(new ProblemDetailsError(404, `User ${username} not found`))
  }

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

  if (actor.id !== subject && !(await bot.actorOK(subject, activity))) {
    return next(new PrincipalActorMismatchError(`${subject} is not the actor ${actor.id}`, { principal: subject, actor: actor.id }))
  }

  if (await actorStorage.isInCollection(username, 'blocked', actor)) {
    return next(new ActorNotAuthorizedError('Blocked actor', { actor: actor.id, resource: req.url }))
  }

  if (!activity.id) {
    return next(new ProblemDetailsError(400, 'No activity id found in activity'))
  }

  if (await actorStorage.isInCollection(bot.username, 'inbox', activity)) {
    return next(new DuplicateDeliveryError('Activity already delivered', { id: activity.id }))
  }

  logger.info(
    { reqId: req.id, activity: activity.id, bot: bot.username },
    'Activity received at bot inbox'
  )

  await deliverer.deliverTo(activity, bot)

  if (deliverer.isPublic(activity)) {
    await deliverer.deliverPublic(activity, bots)
  }

  res.status(202)
  res.type('text/plain')
  res.send(http.STATUS_CODES[202])
})

router.get('/user/:username/inbox', async (req, res, next) => {
  return next(new PrincipalNotAuthorizedError('No access to inbox collection', { resource: req.url }))
})

router.get('/user/:username/inbox/:n', async (req, res, next) => {
  return next(new PrincipalNotAuthorizedError('No access to inbox collection', { resource: req.url }))
})

export default router
