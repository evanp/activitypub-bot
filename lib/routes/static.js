import { Router } from 'express'
import { fileURLToPath } from 'node:url'

const router = Router()

const COMPONENT_BUNDLE_FILENAME = fileURLToPath(import.meta.resolve('@socialwebfoundation/ap-components/dist/ap-components.min.js'))

router.get('/js/ap-components.min.js', (req, res) => {
  res.sendFile(COMPONENT_BUNDLE_FILENAME, { maxAge: 0 })
})

export default router
