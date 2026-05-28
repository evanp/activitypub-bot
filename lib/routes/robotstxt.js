import { Router } from 'express'

const router = Router()

const ROBOTS_TXT =
`# We are all bots here
User-agent: *
Disallow:
`

router.get('/robots.txt', async (req, res, next) => {
  res.status(200).type('text/plain').end(ROBOTS_TXT)
})

export default router
