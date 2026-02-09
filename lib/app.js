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
import webfingerRouter from './routes/webfinger.js'
import sharedInboxRouter from './routes/sharedinbox.js'
import { BotContext } from './botcontext.js'
import { Transformer } from './microsyntax.js'
import { HTTPSignatureAuthenticator } from './httpsignatureauthenticator.js'
import { Digester } from './digester.js'
import { runMigrations } from './migrations/index.js'
import { ActivityDeliverer } from './activitydeliverer.js'

export async function makeApp (databaseUrl, origin, bots, logLevel = 'silent') {
  const logger = Logger({
    level: logLevel
  })
  logger.debug('Logger initialized')
  const connection = databaseUrl === 'sqlite::memory:' || databaseUrl === 'sqlite::memory'
    ? new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    : new Sequelize(databaseUrl, { logging: false })
  await runMigrations(connection)
  const formatter = new UrlFormatter(origin)
  const signer = new HTTPSignature(logger)
  const digester = new Digester(logger)
  const actorStorage = new ActorStorage(connection, formatter)
  const botDataStorage = new BotDataStorage(connection)
  const keyStorage = new KeyStorage(connection, logger)
  const objectStorage = new ObjectStorage(connection)
  const client =
    new ActivityPubClient(keyStorage, formatter, signer, digester, logger)
  const remoteKeyStorage = new RemoteKeyStorage(client, connection, logger)
  const signature = new HTTPSignatureAuthenticator(remoteKeyStorage, signer, digester, logger)
  const distributor = new ActivityDistributor(
    client,
    formatter,
    actorStorage,
    logger
  )
  const authorizer = new Authorizer(actorStorage, formatter, client)
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
  const deliverer = new ActivityDeliverer(
    actorStorage,
    activityHandler,
    formatter,
    logger,
    client
  )

  // TODO: Make an endpoint for tagged objects
  const transformer = new Transformer(origin + '/tag/', client)

  await Promise.all(
    Object.entries(bots).map(([key, bot]) => bot.initialize(
      new BotContext(
        key,
        botDataStorage,
        objectStorage,
        actorStorage,
        client,
        distributor,
        formatter,
        transformer,
        logger
      )
    ))
  )

  const app = express()

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
    activityHandler,
    origin,
    deliverer
  }

  app.use(HTTPLogger({
    logger,
    level: logLevel
  }))

  app.use(express.json({
    type: [
      'application/activity+json',
      'application/ld+json',
      'application/json'
    ],
    verify: (req, res, buf, encoding) => {
      req.rawBodyText = buf.toString(encoding || 'utf8')
    }
  }))

  app.use(signature.authenticate.bind(signature))

  app.use('/', serverRouter)
  app.use('/', userRouter)
  app.use('/', collectionRouter)
  app.use('/', inboxRouter)
  app.use('/', objectRouter)
  app.use('/', healthRouter)
  app.use('/', webfingerRouter)
  app.use('/', sharedInboxRouter)

  app.use(async (req, res) => {
    if (req.accepts('json')) {
      const status = 404
      const title = http.STATUS_CODES[status] || 'Not Found'
      res.status(status)
      res.type('application/problem+json')
      res.json({
        type: 'about:blank',
        title,
        status,
        detail: 'Not found',
        instance: req.originalUrl
      })
    } else {
      res.status(404).send('Not found')
    }
  })

  app.use((err, req, res, next) => {
    const { logger } = req.app.locals
    let status = 500
    if (err.status) {
      status = err.status
    }
    const title = (http.STATUS_CODES[status])
      ? http.STATUS_CODES[status]
      : 'Unknown Status'

    if (status >= 500 && status < 600) {
      logger.error(err)
    } else if (status >= 400 && status < 500) {
      logger.warn(err)
    } else {
      logger.debug(err)
    }
    res.status(status)
    res.type('application/problem+json')
    res.json({ type: 'about:blank', title, status, detail: err.message })
  })

  app.onIdle = async () => {
    logger.debug('Awaiting components')
    await distributor.onIdle()
    await deliverer.onIdle()
    logger.debug('Done awaiting components')
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
