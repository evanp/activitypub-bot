export const id = '005-rate-limit'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    CREATE TABLE rate_limit (
      host varchar(256) NOT NULL PRIMARY KEY,
      remaining INTEGER default 0,
      reset TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `, queryOptions)
}
