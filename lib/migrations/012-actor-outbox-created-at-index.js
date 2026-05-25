export const id = '012-actor-outbox-created-at-index'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    CREATE INDEX actorcollectionpage_outbox_createdat
    ON actorcollectionpage (createdat)
    WHERE property = 'outbox';
  `, queryOptions)
}
