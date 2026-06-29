export const id = '015-domain-block'

export async function up (connection, queryOptions = {}) {
  const tsType = (connection.getDialect() === 'postgres')
    ? 'TIMESTAMPTZ'
    : 'TIMESTAMP'
  await connection.query(`
    CREATE TABLE domain_block (
      domain_name VARCHAR(256) PRIMARY KEY,
      created_at ${tsType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, queryOptions)
}
