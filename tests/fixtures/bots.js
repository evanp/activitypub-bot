import DoNothingBot from '../../lib/bots/donothing.js'
import OKBot from '../../lib/bots/ok.js'
import ProvinceBotFactory from './provincebotfactory.js'

export default {
  ok: new OKBot('ok'),
  null: new DoNothingBot('null'),
  test0: new DoNothingBot('test0'),
  test1: new DoNothingBot('test1'),
  test2: new DoNothingBot('test2'),
  test3: new DoNothingBot('test3'),
  test4: new DoNothingBot('test4'),
  test5: new DoNothingBot('test5'),
  test6: new DoNothingBot('test6'),
  test7: new DoNothingBot('test7'),
  '*': new ProvinceBotFactory()
}
