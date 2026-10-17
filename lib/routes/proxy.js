import express from 'express'
import cors from 'cors'

import as2 from '../activitystreams.js'
import { ProblemDetailsError } from '../errors/problemdetailserror.js'

const router = express.Router()

router.use('/shared/proxy', cors((req, callback) => {
  callback(null, {
    origin: req.app.locals.origin,
    methods: ['POST'],
    optionsSuccessStatus: 200,
    preflightContinue: true
  })
}))

router.post('/shared/proxy', async (req, res, next) => {
  const { client, logger, domainBlocker } = req.app.locals
  const { id } = req.body

  if (!id) {
    return next(new ProblemDetailsError(400, 'Missing id parameter'))
  }

  let url

  try {
    url = new URL(id)
  } catch (error) {
    return next(new ProblemDetailsError(400, 'id must be an URL'))
  }

  if (url.protocol !== 'https:') {
    return next(new ProblemDetailsError(400, 'id must be an https: URL'))
  }

  let obj

  if (await domainBlocker.isBlocked(id)) {
    return next(new ProblemDetailsError(403, 'blocked domain'))
  }

  try {
    obj = await client.get(id)
  } catch (err) {
    logger.warn({ reqId: req.id, err, id }, 'Error fetching object in proxy')
    return next(new ProblemDetailsError(400, `Error fetching object ${id}`))
  }

  if (await domainBlocker.isBlockedObject(obj)) {
    return next(new ProblemDetailsError(403, 'content from blocked domain'))
  }

  res.status(200)
  res.type(as2.mediaType)
  res.end(await obj.write())
})

export default router
