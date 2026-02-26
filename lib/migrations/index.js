import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { readdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const migrationFiles = readdirSync(__dirname)
  .filter(file => /^\d{3}-.*\.js$/.test(file))
  .sort()

const migrations = await Promise.all(
  migrationFiles.map(async (file) => {
    const module = await import(resolve(__dirname, file))
    return { id: module.id, up: module.up }
  })
)

async function runMigrationsInternal (connection, queryOptions = {}) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id VARCHAR(255) PRIMARY KEY,
      ranAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, queryOptions)

  const [rows] = await connection.query('SELECT id FROM migrations', queryOptions)
  const applied = new Set(rows.map((row) => row.id))

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue
    }
    await migration.up(connection, queryOptions)
    await connection.query(
      'INSERT INTO migrations (id) VALUES (?) ON CONFLICT (id) DO NOTHING',
      { ...queryOptions, replacements: [migration.id] }
    )
  }
}

export async function runMigrations (connection) {
  if (connection.getDialect() === 'postgres') {
    await connection.transaction(async (transaction) => {
      await connection.query(
        'SELECT pg_advisory_xact_lock(1600846134, 804024271)',
        { transaction }
      )
      await runMigrationsInternal(connection, { transaction })
    })
  } else {
    await runMigrationsInternal(connection)
  }
}
