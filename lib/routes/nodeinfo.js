import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Router } from 'express'

import { ProblemDetailsError } from '../errors.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const packageName = 'activitypub-bot'

const { version: packageVersion } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
)

const router = Router()

const VERSIONS = ['2.0']

router.get('/.well-known/nodeinfo', async (req, res, next) => {
  const { origin } = req.app.locals
  res.status(200).json({
    links: VERSIONS.map(v => {
      return {
        rel: `http://nodeinfo.diaspora.software/ns/schema/${v}`,
        href: `${origin}/nodeinfo/${v}`
      }
    })
  })
})

router.get('/nodeinfo/:nodeinfoVersion', async (req, res, next) => {
  const { nodeinfoVersion } = req.params
  const { keyStorage } = req.app.locals
  if (!VERSIONS.includes(nodeinfoVersion)) {
    throw new ProblemDetailsError(404, 'unsupported nodeinfo version')
  }
  res.status(200).json({
    version: nodeinfoVersion,
    software: {
      name: packageName,
      version: packageVersion
    },
    protocols: ['activitypub'],
    services: {
      inbound: [],
      outbound: []
    },
    openRegistrations: false,
    usage: {
      users: {
        total: await keyStorage.count()
      }
    },
    metadata: {}
  })
})

export default router
