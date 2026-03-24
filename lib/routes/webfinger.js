import assert from 'node:assert'

import { Router } from 'express'
import createHttpError from 'http-errors'

import BotMaker from '../botmaker.js'

const router = Router()

async function botWebfinger (username, req, res, next) {
  const { formatter, bots } = req.app.locals
  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(createHttpError(404, `No such bot '${username}'`))
  }
  res.status(200)
  res.type('application/jrd+json')
  res.json({
    subject: formatter.acct(username),
    aliases: [formatter.format({ username })],
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: formatter.format({ username })
      },
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: formatter.format({ username, type: 'profile' })
      }
    ]
  })
}

async function profileWebfinger (username, profileUrl, req, res, next) {
  const { formatter, bots } = req.app.locals
  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(createHttpError(404, `No such bot '${username}'`))
  }
  res.status(200)
  res.type('application/jrd+json')
  res.json({
    subject: profileUrl,
    links: [
      {
        rel: 'alternate',
        type: 'application/activity+json',
        href: formatter.format({ username })
      }
    ]
  })
}

async function httpsWebfinger (resource, req, res, next) {
  const { formatter } = req.app.locals
  assert.ok(formatter)
  if (!formatter.isLocal(resource)) {
    return next(createHttpError(400, 'Only local URLs'))
  }
  const parts = formatter.unformat(resource)
  if (parts.username && !parts.type && !parts.collection) {
    return await botWebfinger(parts.username, req, res, next)
  } else if (parts.username && parts.type === 'profile') {
    return await profileWebfinger(parts.username, resource, req, res, next)
  } else {
    return next(createHttpError(400, `No webfinger lookup for url ${resource}`))
  }
}

async function acctWebfinger (resource, req, res, next) {
  const [username, domain] = resource.substring(5).split('@')
  if (!username || !domain) {
    return next(createHttpError(400, `Invalid resource parameter ${resource}`))
  }
  const { host } = new URL(req.app.locals.origin)
  if (domain !== host) {
    return next(createHttpError(400, `Invalid domain ${domain} in resource parameter`))
  }
  return await botWebfinger(username, req, res, next)
}

router.get('/.well-known/webfinger', async (req, res, next) => {
  const { resource } = req.query
  if (!resource) {
    return next(createHttpError(400, 'resource parameter is required'))
  }
  const colon = resource.indexOf(':')
  const protocol = resource.slice(0, colon)

  switch (protocol) {
    case 'acct':
      return await acctWebfinger(resource, req, res, next)
    case 'https':
      return await httpsWebfinger(resource, req, res, next)
    default:
      return next(
        createHttpError(400, `Unsupported resource protocol '${protocol}'`)
      )
  }
})

export default router
