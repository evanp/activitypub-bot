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
    delivery: { type: 'string' },
    distribution: { type: 'string' },
    fanout: { type: 'string' },
    intake: { type: 'string' },
    'index-file': { type: 'string' },
    'profile-file': { type: 'string' },
    'allow-private': { type: 'boolean' },
    'redis-url': { type: 'string' },
    'trust-proxy': { type: 'string' },
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
  --delivery <number>        Number of background delivery workers
  --distribution <number>    Number of background distribution workers
  --fanout <number>          Number of background fanout workers
  --intake <number>          Number of background intake workers
  --index-file <path>        HTML page to show at root path
  --profile-file <path>      HTML page to show for bot profiles
  --allow-private            flag to allow private network requests
  --redis-url <url>          Redis connection URL for rate limiting
  --trust-proxy <value>      Express 'trust proxy' setting (e.g. "1", "loopback", "true")
  -h, --help                 Show this help
`)
  process.exit(0)
}

const normalize = (value) => (value === '' ? undefined : value)
const parseNumber = (value) => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}
function parseBoolean (value) {
  if (value == null || value === '') return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

const baseDir = dirname(fileURLToPath(import.meta.url))
const DEFAULT_BOTS_CONFIG_FILE = resolve(baseDir, '..', 'bots', 'index.js')
const DEFAULT_INDEX_FILE = resolve(baseDir, '..', 'web', 'index.html')
const DEFAULT_PROFILE_FILE = resolve(baseDir, '..', 'web', 'profile.html')

const DATABASE_URL = normalize(values['database-url']) || process.env.DATABASE_URL || 'sqlite::memory:'
const ORIGIN = normalize(values.origin) || process.env.ORIGIN || 'https://activitypubbot.test'
const PORT = parseNumber(normalize(values.port)) || parseNumber(process.env.PORT) || 9000 // HAL
const BOTS_CONFIG_FILE =
  normalize(values['bots-config-file']) || process.env.BOTS_CONFIG_FILE || DEFAULT_BOTS_CONFIG_FILE
const LOG_LEVEL =
  normalize(values['log-level']) ||
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === 'test' ? 'silent' : 'info')
const DELIVERY = parseNumber(values.delivery) || parseNumber(process.env.DELIVERY) || 2
const DISTRIBUTION = parseNumber(values.distribution) || parseNumber(process.env.DISTRIBUTION) || 8
const FANOUT = parseNumber(values.fanout) || parseNumber(process.env.FANOUT) || 4
const INTAKE = parseNumber(values.intake) || parseNumber(process.env.INTAKE) || 2
const INDEX_FILE = values['index-file'] || process.env.INDEX_FILE || DEFAULT_INDEX_FILE
const PROFILE_FILE = values['profile-file'] || process.env.PROFILE_FILE || DEFAULT_PROFILE_FILE
const REDIS_URL = normalize(values['redis-url']) || process.env.REDIS_URL || undefined
const TRUST_PROXY_RAW = normalize(values['trust-proxy']) || process.env.TRUST_PROXY
const TRUST_PROXY = (() => {
  if (TRUST_PROXY_RAW == null) return undefined
  const trimmed = TRUST_PROXY_RAW.trim()
  const num = Number.parseInt(trimmed, 10)
  if (!Number.isNaN(num) && String(num) === trimmed) return num
  const bool = parseBoolean(trimmed)
  if (bool !== undefined) return bool
  return trimmed
})()
const ALLOW_PRIVATE = values['allow-private'] ||
  ('ALLOW_PRIVATE' in process.env)
  ? parseBoolean(process.env.ALLOW_PRIVATE)
  : false

const bots = (await import(BOTS_CONFIG_FILE)).default

const app = await makeApp({
  databaseUrl: DATABASE_URL,
  origin: ORIGIN,
  bots,
  logLevel: LOG_LEVEL,
  deliveryWorkerCount: DELIVERY,
  distributionWorkerCount: DISTRIBUTION,
  fanoutWorkerCount: FANOUT,
  intakeWorkerCount: INTAKE,
  indexFileName: INDEX_FILE,
  profileFileName: PROFILE_FILE,
  allowPrivateNetworkRequests: ALLOW_PRIVATE,
  redisUrl: REDIS_URL,
  trustProxy: TRUST_PROXY
})

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
