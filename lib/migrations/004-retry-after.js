export const id = '003-jobqueue'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    ALTER TABLE job
    ADD COLUMN retry_after TIMESTAMP;
  `, queryOptions)
}
