import express from 'express'
import cors from 'cors'

import as2 from '../activitystreams.js'
import { ProblemDetailsError } from '../errors/problemdetailserror.js'
import { PrincipalNotAuthorizedError } from '../errors/principalnotauthorizederror.js'
import { filterAsync } from '../filterasync.js'

function toArray (value) {
  return (Array.isArray(value))
    ? value
    : [value]
}

const router = express.Router()

export default router

// This applies for all sub-paths, too

router.use('/user/:username/:type/:nanoid', cors({
  methods: ['GET', 'HEAD'],
  preflightContinue: true
}))

router.get('/user/:username/:type/:nanoid', async (req, res, next) => {
  const { username, type, nanoid } = req.params
  if (!nanoid.match(/^[A-Za-z0-9_\\-]{21}$/)) {
    return next(new ProblemDetailsError(400, `Invalid nanoid ${nanoid}`))
  }
  const { objectStorage, formatter, authorizer } = req.app.locals
  const id = formatter.format({ username, type, nanoid })
  const object = await objectStorage.read(id)
  if (!object) {
    return next(new ProblemDetailsError(404, `Object ${id} not found`))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!await authorizer.canRead(remote, object)) {
    return next(new PrincipalNotAuthorizedError('Forbidden to read object', { id }))
  }
  res.status(200)
  res.type(as2.mediaType)
  res.end(await object.prettyWrite())
})

router.get('/user/:username/:type/:nanoid/:collection', async (req, res, next) => {
  const { objectStorage, formatter, authorizer, domainBlocker } = req.app.locals
  if (!['replies', 'likes', 'shares', 'thread'].includes(req.params.collection)) {
    return next(new ProblemDetailsError(404, 'Not Found'))
  }
  const { username, type, nanoid } = req.params
  if (!nanoid.match(/^[A-Za-z0-9_\\-]{21}$/)) {
    return next(new ProblemDetailsError(400, `Invalid nanoid ${nanoid}`))
  }
  const id = formatter.format({ username, type, nanoid })
  const object = await objectStorage.read(id)
  if (!object) {
    return next(new ProblemDetailsError(404, 'Not Found'))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!await authorizer.canRead(remote, object)) {
    return next(new ProblemDetailsError(403, 'Forbidden'))
  }
  const collection = await objectStorage.getCollection(id, req.params.collection)
  const exported = await collection.export({ useOriginalContext: true })
  if ('orderedItems' in exported) {
    exported.orderedItems = await filterAsync(toArray(exported.orderedItems), async (id) => {
      return !await domainBlocker.isBlocked(id)
    })
  }
  res.status(200)
  res.type(as2.mediaType)
  res.json(exported)
})

router.get('/user/:username/:type/:nanoid/:collection/seekItem', async (req, res, next) => {
  const { objectStorage, formatter, authorizer, domainBlocker, client } = req.app.locals
  if (!['replies', 'likes', 'shares', 'thread'].includes(req.params.collection)) {
    return next(new ProblemDetailsError(404, 'Not Found'))
  }
  const { username, type, nanoid, collection } = req.params
  if (!nanoid.match(/^[A-Za-z0-9_\\-]{21}$/)) {
    return next(new ProblemDetailsError(400, `Invalid nanoid ${nanoid}`))
  }
  const id = formatter.format({ username, type, nanoid })
  let object
  try {
    object = await objectStorage.read(id)
  } catch (err) {
    req.log.error({ err })
    return next(new ProblemDetailsError(404, 'Not Found'))
  }
  if (!object) {
    return next(new ProblemDetailsError(404, 'Not Found'))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!await authorizer.canRead(remote, object)) {
    return next(new ProblemDetailsError(404, 'Object not found in collection'))
  }
  const itemId = req.query?.item
  if (!itemId) {
    return next(new ProblemDetailsError(400, 'item parameter required'))
  }
  if (Array.isArray(itemId)) {
    return next(new ProblemDetailsError(400, 'only one item parameter allowed'))
  }
  const page = await objectStorage.getItemPage(id, collection, await as2.import({ id: itemId }))

  if (page === -1) {
    return next(new ProblemDetailsError(404, 'Object not found in collection'))
  }

  if (await domainBlocker.isBlocked(itemId)) {
    return next(new ProblemDetailsError(404, 'Object not found in collection'))
  }

  let item

  try {
    item = (formatter.isLocal(itemId))
      ? await objectStorage.read(itemId)
      : await client.get(itemId)
  } catch (err) {
    req.log.error({ err })
    return next(new ProblemDetailsError(404, 'Object not found in collection'))
  }

  if (!item) {
    return next(new ProblemDetailsError(404, 'Object not found in collection'))
  }

  if (!await authorizer.canRead(remote, item)) {
    return next(new ProblemDetailsError(404, 'Object not found in collection'))
  }

  switch (page) {
    case 0:
      res.redirect(307, formatter.format({ username, type, nanoid, collection }))
      break
    default:
      res.redirect(307, formatter.format({ username, type, nanoid, collection, page }))
  }
})

router.get('/user/:username/:type/:nanoid/:collection/:n', async (req, res, next) => {
  const { username, type, nanoid, collection, n } = req.params
  let pageNo
  try {
    pageNo = parseInt(n)
  } catch (err) {
    return next(new ProblemDetailsError(400, `Invalid page ${n}`))
  }
  if (!nanoid.match(/^[A-Za-z0-9_\\-]{21}$/)) {
    return next(new ProblemDetailsError(400, `Invalid nanoid ${nanoid}`))
  }
  const { objectStorage, formatter, authorizer, domainBlocker } = req.app.locals
  if (!['replies', 'likes', 'shares', 'thread'].includes(req.params.collection)) {
    return next(new ProblemDetailsError(404, 'Not Found'))
  }
  const id = formatter.format({ username, type, nanoid })
  const object = await objectStorage.read(id)
  if (!object) {
    return next(new ProblemDetailsError(404, 'Not Found'))
  }
  const remote = (req.auth?.subject) ? await as2.import({ id: req.auth.subject }) : null
  if (!await authorizer.canRead(remote, object)) {
    return next(new ProblemDetailsError(403, 'Forbidden'))
  }
  const collectionPage = await objectStorage.getCollectionPage(
    id,
    collection,
    pageNo
  )
  const exported = await collectionPage.export({ useOriginalContext: true })
  if ('orderedItems' in exported) {
    exported.orderedItems = await filterAsync(toArray(exported.orderedItems), async (id) => {
      return !await domainBlocker.isBlocked(id)
    })
  }
  res.status(200)
  res.type(as2.mediaType)
  res.json(exported)
})
