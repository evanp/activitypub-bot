import { fileURLToPath } from 'node:url'
import express from 'express'
import as2 from '../activitystreams.js'
import { ProblemDetailsError } from '../errors.js'
import BotMaker from '../botmaker.js'

const router = express.Router()

async function toLink (url, formatter, username, type) {
  if (!url) {
    return null
  }
  if (url.protocol === 'file:') {
    return {
      href: formatter.format({ username, type }),
      type: 'Link'
    }
  } else {
    return {
      href: url.href,
      type: 'Link'
    }
  }
}

router.get('/user/:username', async (req, res, next) => {
  const { username } = req.params
  const { keyStorage, formatter, bots, origin } = req.app.locals
  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(new ProblemDetailsError(404, `User ${username} not found`))
  }
  const publicKeyPem = await keyStorage.getPublicKey(username)
  const acct = formatter.acct(username)
  const wf = acct.slice(5)
  const actor = await as2.import({
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
      'https://purl.archive.org/socialweb/webfinger',
      'https://purl.archive.org/miscellany'
    ],
    id: formatter.format({ username }),
    type: bot.type,
    preferredUsername: username,
    inbox: formatter.format({ username, collection: 'inbox' }),
    outbox: formatter.format({ username, collection: 'outbox' }),
    followers: formatter.format({ username, collection: 'followers' }),
    following: formatter.format({ username, collection: 'following' }),
    liked: formatter.format({ username, collection: 'liked' }),
    to: 'as:Public',
    name: bot.fullname,
    summary: bot.description,
    webfinger: wf,
    publicKey: {
      publicKeyPem,
      id: formatter.format({ username, type: 'publickey' }),
      owner: formatter.format({ username }),
      type: 'CryptographicKey',
      to: 'as:Public'
    },
    endpoints: {
      sharedInbox: `${origin}/shared/inbox`
    },
    icon: await toLink(bot.icon, formatter, username, 'icon'),
    image: await toLink(bot.image, formatter, username, 'image'),
    url: {
      href: formatter.format({ username, type: 'profile' }),
      type: 'Link',
      mediaType: 'text/html'
    },
    manuallyApprovesFollowers: false
  })
  res.status(200)
  res.type(as2.mediaType)
  const body = await actor.prettyWrite(
    { useOriginalContext: true }
  )
  res.end(body)
})

router.get('/user/:username/publickey', async (req, res, next) => {
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

router.get('/user/:username/icon', async (req, res, next) => {
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

router.get('/user/:username/image', async (req, res, next) => {
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

export default router
