import DoNothingBot from '../lib/bots/donothing.js'
import OKBot from '../lib/bots/ok.js'

export default {
  ok: new OKBot('ok'),
  null: new DoNothingBot('null')
}
