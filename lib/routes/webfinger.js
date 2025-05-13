import { Router } from 'express'
import createHttpError from 'http-errors'

const router = Router()

router.get('/.well-known/webfinger', (req, res, next) => {
  const { resource } = req.query
  if (!resource) {
    return next(createHttpError(400, 'resource parameter is required'))
  }
  const [username, domain] = resource.substring(5).split('@')
  if (!username || !domain) {
    return next(createHttpError(400, 'Invalid resource parameter'))
  }
  const { host } = new URL(req.app.locals.origin)
  if (domain !== host) {
    return next(createHttpError(400, 'Invalid domain in resource parameter'))
  }
  if (!(username in req.app.locals.bots)) {
    return next(createHttpError(404, 'Bot not found'))
  }
  res.status(200)
  res.type('application/jrd+json')
  res.json({
    subject: resource,
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: req.app.locals.formatter.format({ username })
      }
    ]
  })
})

export default router
