import express from 'express'
import createHttpError from 'http-errors'

const router = express.Router()

router.get('/livez', async (req, res) => {
  res.status(200)
  res.type('text/plain')
  res.end('OK')
})

router.get('/readyz', async (req, res, next) => {
  const connection = req.app.locals.connection
  try {
    await connection.query('SELECT 1')
    res.status(200)
    res.type('text/plain')
    res.end('OK')
  } catch (err) {
    return next(createHttpError(503, 'Service Unavailable'))
  }
})

export default router
