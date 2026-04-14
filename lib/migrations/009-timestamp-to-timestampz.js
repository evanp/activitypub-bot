export const id = '009-timestamp-to-timestampz'

const COLUMNS = [
  ['actorcollection', 'createdat'],
  ['actorcollection', 'updatedat'],
  ['actorcollectionpage', 'createdat'],
  ['objects', 'createdat'],
  ['objects', 'updatedat'],
  ['collections', 'createdat'],
  ['collections', 'updatedat'],
  ['pages', 'createdat'],
  ['botdata', 'createdat'],
  ['botdata', 'updatedat'],
  ['new_remotekeys', 'createdat'],
  ['new_remotekeys', 'updatedat'],
  ['lastactivity', 'createdat'],
  ['lastactivity', 'updatedat'],
  ['job', 'claimed_at'],
  ['job', 'retry_after'],
  ['job', 'created_at'],
  ['job', 'updated_at'],
  ['rate_limit', 'reset'],
  ['rate_limit', 'created_at'],
  ['rate_limit', 'updated_at'],
  ['failed_job', 'claimed_at'],
  ['failed_job', 'retry_after'],
  ['failed_job', 'created_at'],
  ['failed_job', 'updated_at'],
  ['remote_object_cache', 'last_modified'],
  ['remote_object_cache', 'expiry'],
  ['remote_object_cache', 'created_at'],
  ['remote_object_cache', 'updated_at'],
  ['signature_policy', 'expiry'],
  ['signature_policy', 'created_at'],
  ['signature_policy', 'updated_at']
]

export async function up (connection, queryOptions = {}) {
  if (connection.getDialect() !== 'postgres') {
    return
  }
  for (const [table, column] of COLUMNS) {
    await connection.query(
      `ALTER TABLE "${table}"
       ALTER COLUMN "${column}" TYPE TIMESTAMPTZ
       USING "${column}" AT TIME ZONE 'UTC'`,
      queryOptions
    )
  }
}
