import { id as initialId, up as initialUp } from './001-initial.js'
import { id as lastId, up as lastUp } from './002-last-activity.js'

const migrations = [
  { id: initialId, up: initialUp },
  { id: lastId, up: lastUp }
]

export async function runMigrations (connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id VARCHAR(255) PRIMARY KEY,
      ranAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const [rows] = await connection.query('SELECT id FROM migrations')
  const applied = new Set(rows.map((row) => row.id))

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue
    }
    await migration.up(connection)
    await connection.query(
      'INSERT INTO migrations (id) VALUES (?)',
      { replacements: [migration.id] }
    )
  }
}
