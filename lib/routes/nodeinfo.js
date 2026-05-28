import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Router } from 'express'

import { ProblemDetailsError } from '../errors.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const packageName = 'activitypub-dot-bot'

const { version: packageVersion } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
)

const router = Router()

const VERSIONS = ['2.0', '2.1', '2.2']

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
  const { stats } = req.app.locals
  if (!VERSIONS.includes(nodeinfoVersion)) {
    throw new ProblemDetailsError(404, 'unsupported nodeinfo version')
  }
  const data = await stats.get()
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
        total: data.totalUsers,
        activeMonth: data.activeMonthly,
        activeHalfyear: data.activeHalfYearly
      }
    },
    metadata: {},
    instance: (nodeinfoVersion === '2.2') ? {} : undefined
  })
})

export default router
