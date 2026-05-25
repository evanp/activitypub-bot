import assert from 'node:assert'

const STATS_EXPIRY = 24 * 60 * 60 * 1000

export class ServerStats {
  #keyStorage
  #actorStorage
  #domain
  #connection

  constructor (keyStorage, actorStorage, domain, connection) {
    assert.strictEqual(typeof keyStorage, 'object')
    assert.strictEqual(typeof actorStorage, 'object')
    assert.strictEqual(typeof domain, 'string')
    assert.strictEqual(typeof connection, 'object')

    this.#keyStorage = keyStorage
    this.#actorStorage = actorStorage
    this.#domain = domain
    this.#connection = connection
  }

  async get () {
    let data = await this.#get()
    if (!data || new Date() - data.updatedAt > STATS_EXPIRY) {
      data = {
        totalUsers: await this.#keyStorage.count(),
        activeMonthly: await this.#actorStorage.activeUsers(30),
        activeHalfYearly: await this.#actorStorage.activeUsers(180),
        updatedAt: new Date()
      }
      await this.#update(data)
    }
    return data
  }

  async #update (data) {
    await this.#connection.query(
      `
        INSERT INTO server_stats (domain, total_users, active_monthly, active_half_yearly)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (domain) DO UPDATE
        SET total_users = EXCLUDED.total_users,
            active_monthly = EXCLUDED.active_monthly,
            active_half_yearly = EXCLUDED.active_half_yearly,
            updated_at = CURRENT_TIMESTAMP
      `,
      {
        replacements: [
          this.#domain,
          data.totalUsers,
          data.activeMonthly,
          data.activeHalfYearly
        ]
      }
    )
    return data
  }

  async #get () {
    const [rows] = await this.#connection.query(
      `SELECT total_users, active_monthly, active_half_yearly, updated_at
       FROM server_stats
       WHERE domain = ?
      ;`,
      { replacements: [this.#domain] }
    )

    if (rows.length === 0) {
      return null
    } else {
      return {
        totalUsers: rows[0].total_users,
        activeMonthly: rows[0].active_monthly,
        activeHalfYearly: rows[0].active_half_yearly,
        updatedAt: rows[0].updated_at
      }
    }
  }
}
