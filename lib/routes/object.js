import express from 'express'
import as2 from '../activitystreams.js'
import createHttpError from 'http-errors'

const router = express.Router()

export default router

router.get('/user/:username/:type/:nanoid', async (req, res, next) => {
  const { username, type, nanoid } = req.params
  if (!nanoid.match(/^[A-Za-z0-9_\\-]{21}$/)) {
    return next(createHttpError(400, `Invalid nanoid ${nanoid}`))
  }
  const { objectStorage, formatter, authorizer } = req.app.locals
  const id = formatter.format({ username, type, nanoid })
  const object = await objectStorage.read(id)
  if (!object) {
    return next(createHttpError(404, `Object ${id} not found`))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!await authorizer.canRead(remote, object)) {
    return next(createHttpError(403, `Forbidden to read object ${id}`))
  }
  res.status(200)
  res.type(as2.mediaType)
  res.end(await object.prettyWrite())
})

router.get('/user/:username/:type/:nanoid/:collection', async (req, res, next) => {
  const { objectStorage, formatter, authorizer } = req.app.locals
  if (!['replies', 'likes', 'shares', 'thread'].includes(req.params.collection)) {
    return next(createHttpError(404, 'Not Found'))
  }
  const { username, type, nanoid } = req.params
  if (!nanoid.match(/^[A-Za-z0-9_\\-]{21}$/)) {
    return next(createHttpError(400, `Invalid nanoid ${nanoid}`))
  }
  const id = formatter.format({ username, type, nanoid })
  const object = await objectStorage.read(id)
  if (!object) {
    return next(createHttpError(404, 'Not Found'))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!await authorizer.canRead(remote, object)) {
    return next(createHttpError(403, 'Forbidden'))
  }
  const collection = await objectStorage.getCollection(id, req.params.collection)
  res.status(200)
  res.type(as2.mediaType)
  res.end(await collection.prettyWrite({ useOriginalContext: true }))
})

router.get('/user/:username/:type/:nanoid/:collection/:n', async (req, res, next) => {
  const { username, type, nanoid, collection, n } = req.params
  let pageNo
  try {
    pageNo = parseInt(n)
  } catch (err) {
    return next(createHttpError(400, `Invalid page ${n}`))
  }
  if (!nanoid.match(/^[A-Za-z0-9_\\-]{21}$/)) {
    return next(createHttpError(400, `Invalid nanoid ${nanoid}`))
  }
  const { objectStorage, formatter, authorizer } = req.app.locals
  if (!['replies', 'likes', 'shares', 'thread'].includes(req.params.collection)) {
    return next(createHttpError(404, 'Not Found'))
  }
  const id = formatter.format({ username, type, nanoid })
  const object = await objectStorage.read(id)
  if (!object) {
    return next(createHttpError(404, 'Not Found'))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!await authorizer.canRead(remote, object)) {
    return next(createHttpError(403, 'Forbidden'))
  }
  const collectionPage = await objectStorage.getCollectionPage(
    id,
    collection,
    pageNo
  )
  const exported = await collectionPage.export({ useOriginalContext: true })
  if (!Array.isArray(exported.items)) {
    exported.items = [exported.items]
  }
  res.status(200)
  res.type(as2.mediaType)
  res.json(exported)
})
