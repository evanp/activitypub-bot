export const id = '007-remote-object-cache'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    CREATE TABLE remote_object_cache (
      id varchar(512) NOT NULL,
      username varchar(512) NOT NULL,
      last_modified TIMESTAMP NULL,
      etag varchar(256) NULL,
      expiry TIMESTAMP NULL,
      data TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, username)
    );
  `, queryOptions)
  await connection.query(`
    CREATE INDEX remote_object_cache_expiry on remote_object_cache (expiry);
  `, queryOptions)
}
