export const id = '008-signature-policy'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    CREATE TABLE signature_policy (
      origin varchar(256) NOT NULL PRIMARY KEY,
      policy varchar(32) NOT NULL,
      expiry TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `, queryOptions)
  await connection.query(`
    CREATE INDEX signature_policy_expiry on signature_policy (expiry);
  `, queryOptions)
}
