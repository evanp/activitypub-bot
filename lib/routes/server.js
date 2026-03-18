import express from 'express'
import as2 from '../activitystreams.js'

const router = express.Router()

router.get('/', async (req, res) => {
  const { indexFileName } = req.app.locals
  res.type('html')
  res.sendFile(indexFileName)
})

router.get('/actor', async (req, res) => {
  const homepage = `${req.protocol}://${req.get('host')}/`
  const { formatter } = req.app.locals
  const server = await as2.import({
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    id: formatter.format({ server: true }),
    type: 'Service',
    publicKey: formatter.format({ server: true, type: 'publickey' }),
    url: {
      type: 'Link',
      mediaType: 'text/html',
      href: homepage
    }
  })
  const body = await server.export({ useOriginalContext: true })
  res.status(200)
  res.type(as2.mediaType)
  res.json(body)
})

router.get('/publickey', async (req, res) => {
  const { formatter, keyStorage } = req.app.locals
  const publicKeyPem = await keyStorage.getPublicKey(null)
  const publicKey = await as2.import({
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    publicKeyPem,
    id: formatter.format({ server: true, type: 'publickey' }),
    owner: formatter.format({ server: true }),
    type: 'CryptographicKey',
    to: 'https://www.w3.org/ns/activitystreams#Public'
  })
  res.status(200)
  res.type(as2.mediaType)
  const body = await publicKey.prettyWrite(
    { additional_context: 'https://w3id.org/security/v1' }
  )
  res.end(body)
})

export default router
