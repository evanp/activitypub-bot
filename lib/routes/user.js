import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'

import as2 from '../activitystreams.js'
import { ProblemDetailsError } from '../errors/problemdetailserror.js'
import BotMaker from '../botmaker.js'
import { authenticate } from '../httpsignatureauthenticator.js'

const router = express.Router()

const userCors = cors({
  methods: ['GET', 'HEAD'],
  preflightContinue: true
})

router.get('/user/:username', authenticate, userCors, async (req, res, next) => {
  const { username } = req.params
  const { bots } = req.app.locals
  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(new ProblemDetailsError(404, `User ${username} not found`))
  }
  const actor = await bot._context.botActor(bot)
  res.status(200)
  res.type(as2.mediaType)
  const body = await actor.prettyWrite(
    { useOriginalContext: true }
  )
  res.end(body)
})

router.options('/user/:username', authenticate, userCors)

router.get('/user/:username/publickey', authenticate, userCors, async (req, res, next) => {
  const { username } = req.params
  const { formatter, keyStorage, bots } = req.app.locals
  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(new ProblemDetailsError(404, `User ${username} not found`))
  }
  const publicKeyPem = await keyStorage.getPublicKey(username)
  const publicKey = await as2.import({
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    publicKeyPem,
    id: formatter.format({ username, type: 'publickey' }),
    owner: formatter.format({ username }),
    type: 'CryptographicKey',
    to: 'as:Public'
  })
  res.status(200)
  res.type(as2.mediaType)
  const body = await publicKey.prettyWrite(
    { additional_context: 'https://w3id.org/security/v1' }
  )
  res.end(body)
})
router.options('/user/:username/publickey', authenticate, userCors)

router.get('/user/:username/icon', authenticate, userCors, async (req, res, next) => {
  const { username } = req.params
  const { bots } = req.app.locals
  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(new ProblemDetailsError(404, `User ${username} not found`))
  }
  if (!bot.icon) {
    return next(new ProblemDetailsError(404, `No icon for ${username} found`))
  }

  if (typeof bot.icon !== 'object' || !(bot.icon instanceof URL)) {
    return next(new ProblemDetailsError(500, 'Incorrect image format from bot'))
  }

  if (bot.icon.protocol === 'file:') {
    res.sendFile(fileURLToPath(bot.icon))
  } else {
    res.redirect(307, bot.icon)
  }
})
router.options('/user/:username/icon', authenticate, userCors)

router.get('/user/:username/image', authenticate, userCors, async (req, res, next) => {
  const { username } = req.params
  const { bots } = req.app.locals
  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(new ProblemDetailsError(404, `User ${username} not found`))
  }
  if (!bot.image) {
    return next(new ProblemDetailsError(404, `No image for ${username} found`))
  }

  if (typeof bot.image !== 'object' || !(bot.image instanceof URL)) {
    return next(new ProblemDetailsError(500, 'Incorrect image format from bot'))
  }

  if (bot.image.protocol === 'file:') {
    res.sendFile(fileURLToPath(bot.image))
  } else {
    res.redirect(307, bot.image)
  }
})
router.options('/user/:username/image', authenticate, userCors)

export default router
