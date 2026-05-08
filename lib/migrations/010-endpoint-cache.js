export const id = '010-endpoint-cache'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    CREATE TABLE endpoint_cache (
      actor_id varchar(512) NOT NULL,
      name varchar(64) NOT NULL,
      url varchar(512) NOT NULL,
      expiry TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (actor_id, name)
    );
  `, queryOptions)
  await connection.query(`
    CREATE INDEX endpoint_cache_expiry on endpoint_cache (expiry);
  `, queryOptions)
  await connection.query(`
    CREATE INDEX endpoint_cache_url on endpoint_cache (url);
  `, queryOptions)
}
