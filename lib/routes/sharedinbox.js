import express from 'express'
import as2 from '../activitystreams.js'
import createHttpError from 'http-errors'
import BotMaker from '../botmaker.js'
import assert from 'node:assert'

const router = express.Router()

function isActivity (object) {
  return true
}

function getActor (activity) {
  return activity.actor?.first
}

function getRecipients (obj) {
  let r = []
  for (const prop of ['to', 'cc', 'audience']) {
    const val = obj.get(prop)
    if (val) {
      r = r.concat(Array.from(val))
    }
  }
  return r
}

async function deliverTo (activity, bot, activityHandler, actorStorage, logger) {
  try {
    await activityHandler.handleActivity(bot, activity)
  } catch (err) {
    logger.warn(err)
  }

  await actorStorage.addToCollection(bot.username, 'inbox', activity)
}

async function isFollowersCollection (actor, object, client) {
  assert.strictEqual(typeof actor, 'object')
  assert.strictEqual(typeof actor.id, 'string')
  assert.strictEqual(typeof object, 'object')
  assert.strictEqual(typeof object.id, 'string')
  assert.strictEqual(typeof client, 'object')

  if (actor.followers?.first?.id === object.id &&
    URL.parse(actor.id).origin === URL.parse(object.id).origin) {
    return true
  }

  const fullActor = await client.get(actor.id)

  if (fullActor.followers?.first?.id === object.id) {
    return true
  }

  return false
}

async function getLocalFollowers (actor, actorStorage) {
  return await actorStorage.getUsernamesWith('following', actor)
}

router.post('/shared/inbox', async (req, res, next) => {
  const { bots, actorStorage, activityHandler, formatter, logger, client } = req.app.locals
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

  if (!isActivity(activity)) {
    return next(createHttpError(400, 'Request body is not an activity'))
  }

  const actor = getActor(activity)

  if (!actor) {
    return next(createHttpError(400, 'No actor found in activity'))
  }

  if (!actor.id) {
    return next(createHttpError(400, 'No actor id found in activity'))
  }

  if (actor.id !== subject) {
    return next(createHttpError(403, `${subject} is not the actor ${actor.id}`))
  }

  const deliveredTo = new Set()

  const recipients = getRecipients(activity)

  for (const recipient of recipients) {
    if (formatter.isLocal(recipient.id)) {
      if (formatter.isActor(recipient.id)) {
        const { username } = formatter.unformat(recipient.id)
        if (!deliveredTo.has(username)) {
          const bot = await BotMaker.makeBot(bots, username)
          if (!bot) {
            logger.warn(`sharedInbox direct delivery for unknown bot ${username}`)
            continue
          }
          await deliverTo(activity, bot, activityHandler, actorStorage, logger)
          deliveredTo.add(username)
        }
      } else {
        logger.warn(
          `Unrecognized recipient for remote delivery: ${recipient.id}`
        )
      }
    } else if (await isFollowersCollection(actor, recipient, client)) {
      const followers = await getLocalFollowers(actor, actorStorage)
      for (const username of followers) {
        if (!deliveredTo.has(username)) {
          const bot = await BotMaker.makeBot(bots, username)
          if (!bot) {
            logger.warn(`sharedInbox direct delivery for unknown bot ${username}`)
            continue
          }
          await deliverTo(activity, bot, activityHandler, actorStorage, logger)
          deliveredTo.add(username)
        }
      }
    } else {
      logger.warn(`Unrecognized recipient for shared inbox: ${recipient.id}`)
    }
  }

  res.status(200)
  res.type('text/plain')
  res.send('OK')
})

export default router
