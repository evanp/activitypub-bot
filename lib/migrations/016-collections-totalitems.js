export const id = '016-collections-totalitems'

export async function up (connection, queryOptions = {}) {
  await connection.query(`
    ALTER TABLE collections
    ADD COLUMN totalItems INTEGER NOT NULL DEFAULT 0
  `, queryOptions)
  await connection.query(`
    UPDATE collections
    SET totalItems = (
      SELECT COUNT(*) AS count FROM pages WHERE id = collections.id AND property = collections.property
    )
  `, queryOptions)
}
