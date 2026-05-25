export const id = '014-server-stats'

export async function up (connection, queryOptions = {}) {
  const tsType = (connection.getDialect() === 'postgres')
    ? 'TIMESTAMPTZ'
    : 'TIMESTAMP'
  await connection.query(`
    CREATE TABLE server_stats (
      domain VARCHAR(256) PRIMARY KEY,
      total_users INT NOT NULL DEFAULT 0,
      active_monthly INT NOT NULL DEFAULT 0,
      active_half_yearly INT NOT NULL DEFAULT 0,
      created_at ${tsType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at ${tsType}  NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, queryOptions)
}
