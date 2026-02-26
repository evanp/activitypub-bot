export const id = '003-jobqueue'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    CREATE TABLE job (
      job_id char(21) NOT NULL PRIMARY KEY,
      queue_id varchar(64) NOT NULL,
      priority INTEGER,
      payload TEXT,
      claimed_at TIMESTAMP,
      claimed_by varchar(64),
      attempts INTEGER default 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `, queryOptions)
  await connection.query(`
    CREATE INDEX job_queue_id on job (queue_id);
  `, queryOptions)
}
