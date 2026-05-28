import { Router } from 'express'

const router = Router()

const FAVICON_ICO =
`<svg
xmlns="http://www.w3.org/2000/svg"
viewBox="0 0 100 100">
<text y=".9em" font-size="90">🤖</text>
</svg>`

router.get('/favicon.ico', async (req, res, next) => {
  res.status(200).type('image/svg+xml').end(FAVICON_ICO)
})

export default router
