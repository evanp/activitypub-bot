export const id = '017-profile-hash'

export async function up (connection, queryOptions = {}) {
  const tsType = (connection.getDialect() === 'postgres')
    ? 'TIMESTAMPTZ'
    : 'TIMESTAMP'
  await connection.query(`
    CREATE TABLE profile_hash (
      username varchar(512) NOT NULL,
      property varchar(64) NOT NULL,
      sha256 varchar(64) NOT NULL,
      created_at ${tsType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at ${tsType}  NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (username, property)
    )
  `, queryOptions)
}
