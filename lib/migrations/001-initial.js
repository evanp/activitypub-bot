export const id = '001-initial'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS actorcollection (
      username varchar(512) NOT NULL,
      property varchar(512) NOT NULL,
      first INTEGER NOT NULL,
      totalItems INTEGER NOT NULL DEFAULT 0,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (username, property)
    );
  `, queryOptions)
  await connection.query(`
    CREATE TABLE IF NOT EXISTS actorcollectionpage (
      username varchar(512) NOT NULL,
      property varchar(512) NOT NULL,
      item varchar(512) NOT NULL,
      page INTEGER NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (username, property, item)
    );
  `, queryOptions)
  await connection.query(
    `CREATE INDEX IF NOT EXISTS actorcollectionpage_username_property_page
    ON actorcollectionpage (username, property, page);`,
    queryOptions
  )

  await connection.query(`
    CREATE TABLE IF NOT EXISTS objects (
      id VARCHAR(512) PRIMARY KEY,
      data TEXT NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, queryOptions)
  await connection.query(`
    CREATE TABLE IF NOT EXISTS collections (
      id VARCHAR(512) NOT NULL,
      property VARCHAR(512) NOT NULL,
      first INTEGER NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, property)
    )
  `, queryOptions)
  await connection.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id VARCHAR(512) NOT NULL,
      property VARCHAR(64) NOT NULL,
      item VARCHAR(512) NOT NULL,
      page INTEGER NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, property, item)
    )
  `, queryOptions)
  await connection.query(
    `CREATE INDEX IF NOT EXISTS pages_username_property_page
    ON pages (id, property, page);`,
    queryOptions
  )

  await connection.query(`
    CREATE TABLE IF NOT EXISTS botdata (
      username VARCHAR(512) not null,
      key VARCHAR(512) not null,
      value TEXT not null,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (username, key)
    )
  `, queryOptions)

  await connection.query(`
    CREATE TABLE IF NOT EXISTS new_keys (
      username varchar(512) PRIMARY KEY,
      public_key TEXT,
      private_key TEXT
    )
  `, queryOptions)
  if (await hasTable(connection, 'keys', queryOptions)) {
    await connection.query(`
      INSERT INTO new_keys (username, public_key, private_key)
      SELECT bot_id, public_key, private_key
      FROM keys
      ON CONFLICT DO NOTHING
    `, queryOptions)
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS new_remotekeys (
      id VARCHAR(512) PRIMARY KEY,
      owner VARCHAR(512) NOT NULL,
      publicKeyPem TEXT NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, queryOptions)
  if (await hasTable(connection, 'remotekeys', queryOptions)) {
    await connection.query(`
      INSERT INTO new_remotekeys (id, owner, publicKeyPem)
      SELECT id, owner, publicKeyPem
      FROM remotekeys
      ON CONFLICT DO NOTHING
    `, queryOptions)
  }
}

function normalizeTableName (table) {
  if (typeof table === 'string') {
    return table
      .split('.')
      .pop()
      .replaceAll('"', '')
      .toLowerCase()
  }
  if (table && typeof table === 'object') {
    if (typeof table.tableName === 'string') {
      return table.tableName.toLowerCase()
    }
    if (typeof table.name === 'string') {
      return table.name.toLowerCase()
    }
  }
  return ''
}

async function hasTable (connection, tableName, queryOptions = {}) {
  const tables = await connection.getQueryInterface().showAllTables(queryOptions)
  const normalized = tableName.toLowerCase()
  return tables.some((table) => normalizeTableName(table) === normalized)
}
