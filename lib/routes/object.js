import express from 'express'
import as2 from 'activitystrea.ms'
import createHttpError from 'http-errors'

const router = express.Router()

export default router

router.get('/user/:username/:type/:nanoid([A-Za-z0-9_\\-]{21})', async (req, res, next) => {
  const { username, type, nanoid } = req.params
  const { objectStorage, formatter, authorizer } = req.app.locals
  const id = formatter.format({ username, type, nanoid })
  const object = await objectStorage.read(id)
  if (!object) {
    return next(createHttpError(404, `Object ${id} not found`))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!authorizer.canRead(remote, object)) {
    return next(createHttpError(403, `Forbidden to read object ${id}`))
  }
  res.status(200)
  res.type(as2.mediaType)
  res.end(await object.prettyWrite())
})

router.get('/user/:username/:type/:nanoid([A-Za-z0-9_\\-]{21})/:collection', async (req, res, next) => {
  const { objectStorage, formatter, authorizer } = req.app.locals
  if (!['replies', 'likes', 'shares'].includes(req.params.collection)) {
    return next(createHttpError(404, 'Not Found'))
  }
  const id = formatter.format({ username: req.params.username, type: req.params.type, nanoid: req.params.nanoid })
  const object = await objectStorage.read(id)
  if (!object) {
    return next(createHttpError(404, 'Not Found'))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!authorizer.canRead(remote, object)) {
    return next(createHttpError(403, 'Forbidden'))
  }
  const collection = await objectStorage.getCollection(id, req.params.collection)
  res.status(200)
  res.type(as2.mediaType)
  res.end(await collection.prettyWrite())
})

router.get('/user/:username/:type/:nanoid([A-Za-z0-9_\\-]{21})/:collection/:n(\\d+)', async (req, res, next) => {
  const { objectStorage, formatter, authorizer } = req.app.locals
  if (!['replies', 'likes', 'shares'].includes(req.params.collection)) {
    return next(createHttpError(404, 'Not Found'))
  }
  const id = formatter.format({ username: req.params.username, type: req.params.type, nanoid: req.params.nanoid })
  const object = await objectStorage.read(id)
  if (!object) {
    return next(createHttpError(404, 'Not Found'))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!authorizer.canRead(remote, object)) {
    return next(createHttpError(403, 'Forbidden'))
  }
  const collectionPage = await objectStorage.getCollectionPage(id, req.params.collection, req.params.n)
  const exported = await collectionPage.export()
  exported.items = await Promise.all(exported.items.filter((item) =>
    authorizer.canRead(remote, item)
  ))
  res.status(200)
  res.type(as2.mediaType)
  res.end(exported)
})
