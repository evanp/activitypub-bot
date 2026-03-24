export const id = '006-failed-jobs'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    CREATE TABLE failed_job (
      job_id char(21) NOT NULL PRIMARY KEY,
      queue_id varchar(64) NOT NULL,
      priority INTEGER,
      payload TEXT,
      claimed_at TIMESTAMP,
      claimed_by varchar(64),
      attempts INTEGER default 0,
      retry_after TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `, queryOptions)
  await connection.query(`
    CREATE INDEX failed_job_queue_id on job (queue_id);
  `, queryOptions)
}
