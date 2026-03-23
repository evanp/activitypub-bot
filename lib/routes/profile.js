import express from 'express'
import createHttpError from 'http-errors'
import BotMaker from '../botmaker.js'

const router = express.Router()

router.get('/profile/:username', async (req, res, next) => {
  const { username } = req.params
  const { profileFileName, bots } = req.app.locals
  const bot = await BotMaker.makeBot(bots, username)
  if (!bot) {
    return next(createHttpError(404, `User ${username} not found`))
  }
  res.type('html')
  res.sendFile(profileFileName)
})

export default router
