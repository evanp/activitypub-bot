export const id = '011-job-last-error'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    ALTER TABLE job
    ADD COLUMN last_error TEXT;
  `, queryOptions)
  await connection.query(`
    ALTER TABLE failed_job
    ADD COLUMN last_error TEXT;
  `, queryOptions)
}
