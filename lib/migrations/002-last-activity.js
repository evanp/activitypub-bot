export const id = '002-last-activity'

export async function up (connection) {
  await connection.query(`
    CREATE TABLE lastactivity (
      username varchar(512) NOT NULL,
      type varchar(512) NOT NULL,
      object_id varchar(512) NOT NULL,
      activity_id varchar(512),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (username, type, object_id)
    );
  `)
}
