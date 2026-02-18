import assert from 'node:assert'

import Bot from '../bot.js'

const NS = 'https://www.w3.org/ns/activitystreams#'
const FOLLOW = `${NS}Follow`
const PUBLICS = [
  'Public',
  'as:Public',
  `${NS}Public`
]
const CLIENTS = 'relay-clients'

export default class RelayServerBot extends Bot {
  get fullname () {
    return 'Relay Server Bot'
  }

  get description () {
    return 'A bot for accepting relay subscriptions'
  }

  async handleActivity (activity) {
    if (activity.type === FOLLOW &&
      PUBLICS.includes(activity.object?.first?.id)) {
      this._context.logger.debug(
        { activity: activity.id },
        'Non-default handling for relay follow'
      )
      const actorId = activity.actor?.first?.id
      if (actorId) {
        this._context.logger.info(
          { actor: actorId },
          'Adding actor as relay follower'
        )
        // FIXME: will this work at scale?
        const clients = (await this._context.hasData(CLIENTS))
          ? await this._context.getData(CLIENTS)
          : []
        assert.ok(Array.isArray(clients))
        const clientSet = new Set(clients)
        if (!clientSet.has(actorId)) {
          clientSet.add(actorId)
          await this._context.setData(CLIENTS, Array.from(clientSet))
        }
        this._context.logger.debug(
          { activity: activity.id },
          'Accepting follow activity'
        )
        await this._context.doActivity({
          type: 'Accept',
          object: activity.id,
          to: actorId
        })
      }
      return true
    } else {
      return false
    }
  }
}
