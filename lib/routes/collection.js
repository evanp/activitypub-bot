import express from 'express'
import as2 from '../activitystreams.js'
import createHttpError from 'http-errors'
import BotMaker from '../botmaker.js'
import assert from 'node:assert'

const collections = ['outbox', 'liked', 'followers', 'following']
const router = express.Router()

function toArray (value) {
  return (Array.isArray(value))
    ? value
    : [value]
}

async function filterAsync (array, asyncPredicate) {
  assert.ok(array)
  assert.ok(Array.isArray(array))
  // 1. Kick off all predicate calls in parallel:
  const checks = array.map(item => asyncPredicate(item))

  // 2. Wait for all to settle into [true, false, …]:
  const booleans = await Promise.all(checks)

  // 3. Pick only those whose boolean was true:
  return array.filter((_, idx) => booleans[idx])
}

// This got tricky because Express 5 doesn't let us add regexes to our routes,
// so the page routes conflict with the object routes in ./object.js. This
// format lets us define fixed routes for the 4 user collections that support
// GET

function collectionHandler (collection) {
  assert.ok(collections.includes(collection))
  return async (req, res, next) => {
    const { username } = req.params
    const { actorStorage, bots } = req.app.locals
    const bot = await BotMaker.makeBot(bots, username)
    if (!bot) {
      return next(createHttpError(404, `User ${username} not found`))
    }
    const coll = await actorStorage.getCollection(username, collection)
    res.status(200)
    res.type(as2.mediaType)
    res.end(await coll.prettyWrite({ useOriginalContext: true }))
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
      return next(createHttpError(400, `Invalid page ${n}`))
    }
    const { actorStorage, bots, authorizer, objectStorage, formatter, client } = req.app.locals
    const bot = await BotMaker.makeBot(bots, username)

    if (!bot) {
      return next(createHttpError(404, `User ${username} not found`))
    }

    if (collection === 'inbox') {
      return next(createHttpError(403, `No access to ${collection} collection`))
    }
    if (!await actorStorage.hasPage(username, collection, parseInt(n))) {
      return next(createHttpError(404, `No such page ${n} for collection ${collection} for user ${username}`))
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
        exported.items = await filterAsync(toArray(exported.items), async (id) => {
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
              { err, remote: remote.id, object: object.id },
              'Error checking read access'
            )
            result = false
          }
          return result
        })
      }
    } catch (error) {
      req.log.error(
        { err: error, username, collection, n },
        'error loading collection page'
      )
      return next(createHttpError(500, 'Error loading collection page'))
    }
    res.status(200)
    res.type(as2.mediaType)
    res.end(JSON.stringify(exported))
  }
}

for (const collection of collections) {
  router.get(`/user/:username/${collection}`, collectionHandler(collection))
  router.get(
    `/user/:username/${collection}/:n`,
    collectionPageHandler(collection)
  )
}

export default router
