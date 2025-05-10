import { Sequelize } from 'sequelize'
import express from 'express'
import Logger from 'pino'
import HTTPLogger from 'pino-http'
import http from 'node:http'
import { ActivityDistributor } from './activitydistributor.js'
import { ActivityPubClient } from './activitypubclient.js'
import { ActorStorage } from './actorstorage.js'
import { BotDataStorage } from './botdatastorage.js'
import { KeyStorage } from './keystorage.js'
import { ObjectStorage } from './objectstorage.js'
import { UrlFormatter } from './urlformatter.js'
import { HTTPSignature } from './httpsignature.js'
import { Authorizer } from './authorizer.js'
import { RemoteKeyStorage } from './remotekeystorage.js'
import { ActivityHandler } from './activityhandler.js'
import { ObjectCache } from '../lib/objectcache.js'
import serverRouter from './routes/server.js'
import userRouter from './routes/user.js'
import objectRouter from './routes/object.js'
import collectionRouter from './routes/collection.js'
import inboxRouter from './routes/inbox.js'
import healthRouter from './routes/health.js'
import { BotContext } from './botcontext.js'
import { Transformer } from './microsyntax.js'

export async function makeApp (databaseUrl, origin, bots) {
  const app = express()
  const connection = new Sequelize(databaseUrl, { logging: false })
  const formatter = new UrlFormatter(origin)
  const actorStorage = new ActorStorage(connection, formatter)
  await actorStorage.initialize()
  const botDataStorage = new BotDataStorage(connection)
  await botDataStorage.initialize()
  const keyStorage = new KeyStorage(connection)
  await keyStorage.initialize()
  const objectStorage = new ObjectStorage(connection)
  await objectStorage.initialize()
  const client = new ActivityPubClient(keyStorage, formatter)
  const remoteKeyStorage = new RemoteKeyStorage(client, connection)
  await remoteKeyStorage.initialize()
  const signature = new HTTPSignature(remoteKeyStorage)
  const distributor = new ActivityDistributor(
    client,
    formatter,
    actorStorage
  )
  const authorizer = new Authorizer(actorStorage, formatter, client)
  const logger = Logger({
    level: process.env.NODE_ENV === 'test' ? 'silent' : 'info'
  })
  const cache = new ObjectCache({
    longTTL: 3600 * 1000,
    shortTTL: 300 * 1000,
    maxItems: 1000
  })
  const activityHandler = new ActivityHandler(
    actorStorage,
    objectStorage,
    distributor,
    formatter,
    cache,
    authorizer,
    logger,
    client
  )
  // TODO: Make an endpoint for tagged objects
  const transformer = new Transformer(origin + '/tag/', client)
  await Promise.all(
    Object.values(bots).map(bot => bot.initialize(
      new BotContext(
        bot.username,
        botDataStorage,
        objectStorage,
        actorStorage,
        client,
        distributor,
        formatter,
        transformer
      )
    ))
  )
  app.locals = {
    connection,
    formatter,
    actorStorage,
    botDataStorage,
    keyStorage,
    objectStorage,
    remoteKeyStorage,
    client,
    distributor,
    signature,
    logger,
    authorizer,
    bots,
    activityHandler
  }

  app.use(HTTPLogger({
    logger,
    level: process.env.NODE_ENV === 'test' ? 'silent' : 'info'
  }))

  app.use(signature.authenticate.bind(signature))

  app.use('/', serverRouter)
  app.use('/', userRouter)
  app.use('/', collectionRouter)
  app.use('/', objectRouter)
  app.use('/', inboxRouter)
  app.use('/', healthRouter)

  app.use((err, req, res, next) => {
    let status = 500
    if (err.status) {
      status = err.status
    }
    const title = (http.STATUS_CODES[status])
      ? http.STATUS_CODES[status]
      : 'Unknown Status'

    res.status(status)
    res.type('application/problem+json')
    res.json({ type: 'about:blank', title, status, detail: err.message })
  })

  app.onIdle = async () => {
    await distributor.onIdle()
  }

  app.cleanup = async () => {
    logger.info('Closing app')
    logger.info('Waiting for distributor queue')
    await distributor.onIdle()
    logger.info('Closing database connection')
    await connection.close()
  }

  return app
}
