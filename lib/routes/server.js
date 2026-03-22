import express from 'express'

const router = express.Router()

router.get('/', async (req, res) => {
  const { indexFileName } = req.app.locals
  res.type('html')
  res.sendFile(indexFileName)
})

export default router
