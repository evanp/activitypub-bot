import express from 'express'
import as2 from '../activitystreams.js'
import createHttpError from 'http-errors'
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
  const { actorStorage, keyStorage, formatter, bots, origin } = req.app.locals
  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(createHttpError(404, `User ${username} not found`))
  }
  const publicKeyPem = await keyStorage.getPublicKey(username)
  const acct = formatter.acct(username)
  const wf = acct.slice(5)
  const actor = await actorStorage.getActor(username, {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
      'https://purl.archive.org/socialweb/webfinger'
    ],
    name: bot.fullname,
    summary: bot.description,
    webfinger: wf,
    alsoKnownAs: acct,
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
    image: await toLink(bot.image, formatter, username, 'image')
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
    return next(createHttpError(404, `User ${username} not found`))
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

export default router
