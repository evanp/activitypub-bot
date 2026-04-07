import express from 'express'

import as2 from '../activitystreams.js'
import createHttpError from 'http-errors'

const router = express.Router()

router.options('/shared/proxy', (req, res) => {
  const { origin } = req.app.locals
  res.set('Allow', 'POST')
  res.set('Access-Control-Allow-Origin', origin)
  res.status(200).end()
})

router.post('/shared/proxy', async (req, res, next) => {
  const { client, logger, origin } = req.app.locals
  const { id } = req.body

  if (!id) {
    return next(createHttpError(400, 'Missing id parameter'))
  }

  let url

  try {
    url = new URL(id)
  } catch (error) {
    return next(createHttpError(400, 'id must be an URL'))
  }

  if (url.protocol !== 'https:') {
    return next(createHttpError(400, 'id must be an https: URL'))
  }

  let obj

  try {
    obj = await client.get(id)
  } catch (err) {
    logger.warn({ reqId: req.id, err, id }, 'Error fetching object in proxy')
    return next(createHttpError(400, `Error fetching object ${id}`))
  }

  res.status(200)
  res.set('Access-Control-Allow-Origin', origin)
  res.type(as2.mediaType)
  res.end(await obj.write())
})

export default router
