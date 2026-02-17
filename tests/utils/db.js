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
