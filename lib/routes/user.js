import express from 'express'
import as2 from 'activitystrea.ms'
import createHttpError from 'http-errors'

const router = express.Router()

router.get('/user/:username', async (req, res, next) => {
  const { username } = req.params
  const { actorStorage, keyStorage, formatter, bots } = req.app.locals
  if (!(username in bots)) {
    return next(createHttpError(404, `User ${username} not found`))
  }
  const publicKeyPem = await keyStorage.getPublicKey(username)
  const actor = await actorStorage.getActor(username, {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    name: bots[username].fullname,
    summary: bots[username].description,
    publicKey: {
      publicKeyPem,
      id: formatter.format({ username, type: 'publickey' }),
      owner: formatter.format({ username }),
      type: 'PublicKey',
      to: 'as:Public'
    }
  })
  res.status(200)
  res.type(as2.mediaType)
  const body = await actor.prettyWrite(
    { additional_context: 'https://w3id.org/security/v1' }
  )
  res.end(body)
})

router.get('/user/:username/publickey', async (req, res, next) => {
  const { username } = req.params
  const { formatter, keyStorage, bots } = req.app.locals
  if (!(username in bots)) {
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
    type: 'PublicKey',
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
