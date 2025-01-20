import { makeApp } from './lib/app.js'

const DATABASE_URL = process.env.DATABASE_URL || 'sqlite::memory:'
const ORIGIN = process.env.ORIGIN || 'https://activitypubbot.test'
const PORT = process.env.PORT || 9000 // HAL
const BOTS_CONFIG_FILE = process.env.BOTS_CONFIG_FILE || './bots.js'

const bots = (await import(BOTS_CONFIG_FILE)).default

const app = await makeApp(DATABASE_URL, ORIGIN, bots)

const server = app.listen(parseInt(PORT), () => {
  app.locals.logger.info(`Listening on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM')
  server.close(async () => {
    await app.cleanup()
    process.exit(0)
  })
})
