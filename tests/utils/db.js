import { Sequelize } from 'sequelize'
import { runMigrations } from '../../lib/migrations/index.js'

const SQLITE_MEMORY_URL = 'sqlite::memory:'
const SQLITE_MEMORY_ALIASES = new Set([
  'sqlite::memory',
  'sqlite::memory:',
  ':sqlite::memory:',
  ':sqllite::memory:'
])

function normalizeDatabaseUrl (databaseUrl) {
  return SQLITE_MEMORY_ALIASES.has(databaseUrl)
    ? SQLITE_MEMORY_URL
    : databaseUrl
}

function toUrlPattern (domainOrOrigin) {
  if (!domainOrOrigin) {
    return null
  }
  const trimmed = String(domainOrOrigin).trim()
  if (!trimmed) {
    return null
  }
  const origin = trimmed.includes('://')
    ? trimmed.replace(/\/+$/, '')
    : `https://${trimmed}`
  return `${origin}/%`
}

function addLikeClauses (clauses, replacements, column, patterns, keyPrefix) {
  patterns.forEach((pattern, index) => {
    const key = `${keyPrefix}${index}`
    clauses.push(`${column} LIKE :${key}`)
    replacements[key] = pattern
  })
}

async function deleteWhere (connection, table, clauses, replacements = {}) {
  if (clauses.length === 0) {
    return
  }
  await connection.query(
    `DELETE FROM ${table} WHERE ${clauses.join(' OR ')}`,
    { replacements }
  )
}

export function getTestDatabaseUrl () {
  const configured = process.env.TEST_DATABASE_URL
  return normalizeDatabaseUrl(configured || SQLITE_MEMORY_URL)
}

export function createTestConnection (databaseUrl = getTestDatabaseUrl()) {
  const normalized = normalizeDatabaseUrl(databaseUrl)
  return normalized === SQLITE_MEMORY_URL
    ? new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    : new Sequelize(normalized, { logging: false })
}

export async function createMigratedTestConnection (databaseUrl = getTestDatabaseUrl()) {
  const connection = createTestConnection(databaseUrl)
  await connection.authenticate()
  await runMigrations(connection)
  return connection
}

export async function cleanupTestData (connection, {
  usernames = [],
  localDomain = null,
  remoteDomains = []
} = {}) {
  const localPattern = toUrlPattern(localDomain)
  const normalizedRemotePatterns = remoteDomains.map(toUrlPattern).filter(Boolean)
  const allPatterns = localPattern
    ? [localPattern, ...normalizedRemotePatterns]
    : normalizedRemotePatterns

  const actorCollectionPageClauses = []
  const actorCollectionPageReplacements = {}
  if (usernames.length > 0) {
    actorCollectionPageClauses.push('username IN (:usernames)')
    actorCollectionPageReplacements.usernames = usernames
  }
  addLikeClauses(
    actorCollectionPageClauses,
    actorCollectionPageReplacements,
    'item',
    allPatterns,
    'itemPattern'
  )
  await deleteWhere(connection, 'actorcollectionpage', actorCollectionPageClauses, actorCollectionPageReplacements)

  if (usernames.length > 0) {
    const usernameOnlyReplacements = { usernames }
    await deleteWhere(connection, 'actorcollection', ['username IN (:usernames)'], usernameOnlyReplacements)
    await deleteWhere(connection, 'lastactivity', ['username IN (:usernames)'], usernameOnlyReplacements)
    await deleteWhere(connection, 'botdata', ['username IN (:usernames)'], usernameOnlyReplacements)
    await deleteWhere(connection, 'new_keys', ['username IN (:usernames)'], usernameOnlyReplacements)
  }

  const remoteKeyClauses = []
  const remoteKeyReplacements = {}
  addLikeClauses(remoteKeyClauses, remoteKeyReplacements, 'id', normalizedRemotePatterns, 'remoteIdPattern')
  addLikeClauses(remoteKeyClauses, remoteKeyReplacements, 'owner', normalizedRemotePatterns, 'remoteOwnerPattern')
  await deleteWhere(connection, 'new_remotekeys', remoteKeyClauses, remoteKeyReplacements)

  const pageClauses = []
  const pageReplacements = {}
  addLikeClauses(pageClauses, pageReplacements, 'id', allPatterns, 'pageIdPattern')
  addLikeClauses(pageClauses, pageReplacements, 'item', allPatterns, 'pageItemPattern')
  await deleteWhere(connection, 'pages', pageClauses, pageReplacements)

  const collectionClauses = []
  const collectionReplacements = {}
  addLikeClauses(collectionClauses, collectionReplacements, 'id', allPatterns, 'collectionIdPattern')
  await deleteWhere(connection, 'collections', collectionClauses, collectionReplacements)

  const objectClauses = []
  const objectReplacements = {}
  addLikeClauses(objectClauses, objectReplacements, 'id', allPatterns, 'objectIdPattern')
  await deleteWhere(connection, 'objects', objectClauses, objectReplacements)
}
