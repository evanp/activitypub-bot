import assert from 'node:assert'
import cors from 'cors'
import express from 'express'

import as2 from '../activitystreams.js'
import BotMaker from '../botmaker.js'
import { ProblemDetailsError } from '../errors/problemdetailserror.js'
import { PrincipalNotAuthorizedError } from '../errors/principalnotauthorizederror.js'
import { filterAsync } from '../filterasync.js'

const collections = ['outbox', 'liked', 'followers', 'following']
const router = express.Router()

function toArray (value) {
  return (Array.isArray(value))
    ? value
    : [value]
}

function objectFilterer (formatter, objectStorage, client, req, authorizer, remote) {
  return async (id) => {
    const object = (formatter.isLocal(id))
      ? await objectStorage.read(id)
      : await client.get(id)
    if (!object) {
      req.log.warn({ id }, 'could not load object')
      return false
    }
    req.log.debug({ id, object }, 'loaded object')
    let result = false
    try {
      result = await authorizer.canRead(remote, object)
    } catch (err) {
      req.log.debug(
        { err, remote: remote?.id, object: object.id },
        'Error checking read access'
      )
      result = false
    }
    return result
  }
}

function actorFilterer (domainBlocker, req, remote) {
  return async (id) => {
    let result = false
    try {
      result = !await domainBlocker.isBlocked(id)
    } catch (err) {
      req.log.debug(
        { err, remote: remote?.id, object: id },
        'Error checking read access'
      )
      result = false
    }
    return result
  }
}

// This got tricky because Express 5 doesn't let us add regexes to our routes,
// so the page routes conflict with the object routes in ./object.js. This
// format lets us define fixed routes for the 4 user collections that support
// GET

function collectionHandler (collection) {
  assert.ok(collections.includes(collection))
  return async (req, res, next) => {
    const { username } = req.params
    const { actorStorage, bots, authorizer, objectStorage, formatter, client, domainBlocker } = req.app.locals
    const bot = await BotMaker.makeBot(bots, username)
    if (!bot) {
      return next(new ProblemDetailsError(404, `User ${username} not found`))
    }
    const id = req.auth?.subject
    const remote = (id) ? await as2.import({ id }) : null
    const coll = await actorStorage.getCollection(username, collection)
    const exported = await coll.export({ useOriginalContext: true })
    if ('orderedItems' in exported) {
      if (['outbox', 'liked'].includes(collection)) {
        exported.orderedItems = await filterAsync(toArray(exported.orderedItems), objectFilterer(formatter, objectStorage, client, req, authorizer, remote))
      } else if (['followers', 'following'].includes(collection)) {
        exported.orderedItems = await filterAsync(toArray(exported.orderedItems), actorFilterer(domainBlocker, req, remote))
      }
    }
    res.status(200)
    res.type(as2.mediaType)
    res.end(JSON.stringify(exported))
  }
}

function collectionPageHandler (collection) {
  assert.ok(['outbox', 'liked', 'followers', 'following'].includes(collection))
  return async (req, res, next) => {
    const { username, n } = req.params
    let pageNo
    try {
      pageNo = parseInt(n)
    } catch (err) {
      return next(new ProblemDetailsError(400, `Invalid page ${n}`))
    }
    const { actorStorage, bots, authorizer, objectStorage, formatter, client, domainBlocker } = req.app.locals
    const bot = await BotMaker.makeBot(bots, username)

    if (!bot) {
      return next(new ProblemDetailsError(404, `User ${username} not found`))
    }

    if (collection === 'inbox') {
      return next(new PrincipalNotAuthorizedError(`No access to ${collection} collection`, { resource: req.url }))
    }
    if (!await actorStorage.hasPage(username, collection, parseInt(n))) {
      return next(new ProblemDetailsError(404, `No such page ${n} for collection ${collection} for user ${username}`))
    }

    let exported = null

    try {
      const id = req.auth?.subject
      const remote = (id) ? await as2.import({ id }) : null
      const page = await actorStorage.getCollectionPage(
        username,
        collection,
        pageNo
      )
      exported = await page.export({ useOriginalContext: true })
      if (['outbox', 'liked'].includes(collection)) {
        exported.orderedItems = await filterAsync(toArray(exported.orderedItems), objectFilterer(formatter, objectStorage, client, req, authorizer, remote))
      } else if (['followers', 'following'].includes(collection)) {
        exported.orderedItems = await filterAsync(toArray(exported.orderedItems), actorFilterer(domainBlocker, req, remote))
      }
    } catch (error) {
      req.log.error(
        { err: error, username, collection, n },
        'error loading collection page'
      )
      return next(new ProblemDetailsError(500, 'Error loading collection page'))
    }
    res.status(200)
    res.type(as2.mediaType)
    res.end(JSON.stringify(exported))
  }
}

function seekItemHandler (collection) {
  assert.ok(collections.includes(collection))
  return async (req, res, next) => {
    const { username } = req.params
    const { actorStorage, bots, formatter, authorizer, domainBlocker, objectStorage, client } = req.app.locals
    const bot = await BotMaker.makeBot(bots, username)
    if (!bot) {
      return next(new ProblemDetailsError(404, `User ${username} not found`))
    }
    const objectId = req.query?.item
    if (!objectId) {
      return next(new ProblemDetailsError(400, 'item parameter required'))
    }
    if (Array.isArray(objectId)) {
      return next(new ProblemDetailsError(400, 'only one item parameter allowed'))
    }

    const page = await actorStorage.getItemPage(username, collection, await as2.import({ id: objectId }))

    if (page === -1) {
      return next(new ProblemDetailsError(404, 'Object not found in collection'))
    }

    if (['outbox', 'liked'].includes(collection)) {
      let object

      try {
        object = (formatter.isLocal(objectId))
          ? await objectStorage.read(objectId)
          : await client.get(objectId)
      } catch (err) {
        req.log.error({ err })
        return next(new ProblemDetailsError(404, 'Object not found in collection'))
      }

      if (!object) {
        return next(new ProblemDetailsError(404, 'Object not found in collection'))
      }

      const remoteId = req.auth?.subject
      const remote = (remoteId) ? await as2.import({ id: remoteId }) : null

      if (!await authorizer.canRead(remote, object)) {
        return next(new ProblemDetailsError(404, 'Object not found in collection'))
      }
    } else if (['followers', 'following'].includes(collection)) {
      if (await domainBlocker.isBlocked(objectId)) {
        return next(new ProblemDetailsError(404, 'Object not found in collection'))
      }
    }

    if (page === 0) {
      res.redirect(307, formatter.format({ username, collection }))
    } else {
      res.redirect(307, formatter.format({ username, collection, page }))
    }
  }
}

const collectionCors = cors({
  methods: ['GET', 'HEAD'],
  preflightContinue: true
})

for (const collection of collections) {
  // This covers sub-paths, also
  router.use(`/user/:username/${collection}`, collectionCors)
  router.get(`/user/:username/${collection}`, collectionHandler(collection))
  router.get(
    `/user/:username/${collection}/seekItem`,
    seekItemHandler(collection)
  )
  router.get(
    `/user/:username/${collection}/:n`,
    collectionPageHandler(collection)
  )
}

export default router
