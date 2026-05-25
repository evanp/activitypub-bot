export const id = '013-actor-outbox-createdat-username'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    DROP INDEX actorcollectionpage_outbox_createdat;
  `, queryOptions)
  await connection.query(`
    CREATE INDEX actorcollectionpage_outbox_createdat_username
    ON actorcollectionpage (createdat, username)
    WHERE property = 'outbox';
  `, queryOptions)
}
