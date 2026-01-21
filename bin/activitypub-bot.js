#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { makeApp } from '../lib/app.js'

const { values } = parseArgs({
  options: {
    'database-url': { type: 'string' },
    origin: { type: 'string' },
    port: { type: 'string' },
    'bots-config-file': { type: 'string' },
    'log-level': { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  },
  allowPositionals: false
})

if (values.help) {
  console.log(`Usage: activitypub-bot [options]

Options:
  --database-url <url>       Database connection URL
  --origin <url>             Public origin URL for the server
  --port <number>            Port to listen on
  --bots-config-file <path>  Path to bots config module
  --log-level <level>        Log level (e.g., info, debug)
  -h, --help                 Show this help
`)
  process.exit(0)
}

const normalize = (value) => (value === '' ? undefined : value)
const parsePort = (value) => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

const baseDir = dirname(fileURLToPath(import.meta.url))
const DEFAULT_BOTS_CONFIG_FILE = resolve(baseDir, '..', 'bots', 'index.js')

const DATABASE_URL = normalize(values['database-url']) || process.env.DATABASE_URL || 'sqlite::memory:'
const ORIGIN = normalize(values.origin) || process.env.ORIGIN || 'https://activitypubbot.test'
const PORT = parsePort(normalize(values.port)) || parsePort(process.env.PORT) || 9000 // HAL
const BOTS_CONFIG_FILE =
  normalize(values['bots-config-file']) || process.env.BOTS_CONFIG_FILE || DEFAULT_BOTS_CONFIG_FILE
const LOG_LEVEL =
  normalize(values['log-level']) ||
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === 'test' ? 'silent' : 'info')

const bots = (await import(BOTS_CONFIG_FILE)).default

const app = await makeApp(DATABASE_URL, ORIGIN, bots, LOG_LEVEL)

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
