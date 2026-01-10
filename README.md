# activitypub.bot

An ActivityPub server-side bot framework

activitypub.bot is a [social bot](https://en.wikipedia.org/wiki/Social_bot) server
which helps developers create and deploy semi-autonomous actors on the
[ActivityPub](https://activitypub.rocks/) network. Unlike general-purpose social
networking servers, the bot software does not use a remote API like the
ActivityPub API or the Mastodon API. Instead, the bot software runs inside the
server, using an in-process API.

activitypub.bot was originally developed as sample code for [ActivityPub: Programming for the Social Web](https://evanp.me/activitypub-book/) (2024) from O'Reilly Media.

## Table of Contents

- [Security](#security)
- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Contributing](#contributing)
- [License](#license)

## Security

Please use the form at [https://github.com/evanp/activitypub-bot/security](https://github.com/evanp/activitypub-bot/security) to report a vulnerability privately.

## Background

[Mastodon](https://joinmastodon.org/) and other ActivityPub servers implement bots using their API. This requires having a separate deployment for the API client, either as a long-running process, a cron job, or some other implementation.

This server, instead, deploys the bot code inside the server process. This simplifies the interactions between the bot and the server, with the downside that deploying a new bot requires re-deploying the server.

## Install

The easiest way to install this server is using [Helm](https://helm.sh). See the [evanp/activitypub-bot-chart](https://github.com/evanp/activitypub-bot-chart) for instructions.

There is also a Docker image at [ghcr.io/evanp/activitypub-bot](https://ghcr.io/evanp/activitypub-bot).

It's also an [npm](https://npmjs.org/) package, [@evanp/activitypub-bot](https://www.npmjs.com/package/@evanp/activitypub-bot).

## Usage

The server works as an ActivityPub server; bots appear as ActivityPub "actors".

### Environment variables

The package can be configured with the following environment variables.

#### DATABASE_URL

A [sequelize](https://sequelize.org) database URI for storing the server data. The default is 'sqlite::memory', which will store data in memory and lose the data when the process shuts down; you probably don't want that. The server comes with Postgres, MySQL, and SQLite libraries; you might need to install libraries if you're using some other dialect.

The URI format varies by database backend; see [Postgres](https://www.postgresql.org/docs/current/libpq-connect.html), [MySQL](https://dev.mysql.com/doc/refman/8.0/en/connecting-using-uri-or-key-value-pairs.html), or [SQLite](https://sqlite.org/uri.html).

The server creates and alters tables at runtime; whatever user you use to connect should have rights to do those things.

#### ORIGIN

The [origin](https://developer.mozilla.org/en-US/docs/Web/API/URL/origin) (protocol + hostname) for the server. This will only be used for formatting IDs, not for running the server. Use this if you're running the server
behind a load balancer or inside a Kubernetes cluster.

The default is 'https://activitypubbot.test', which doesn't work and probably isn't what you want.

#### PORT

The [port](https://en.wikipedia.org/wiki/Port_(computer_networking)) number to listen on. This is only used for connection; URLs are created using [ORIGIN](#origin). Must be an integer number between 1 and 65535; the default is 9000.

#### LOG_LEVEL

The minimum [pino](https://getpino.io) [log level](https://getpino.io/#/docs/api?id=logger-level) to output. This can be `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. Whatever the log level is, messages with
lower log levels won't appear in the logs. For example, if the log level is `info`, debug and trace log messages will be silently dropped. `silent` turns off logging altogether.

The default is `info` (or `silent` when running unit tests).

#### BOTS_CONFIG_FILE

The path to the [config file](#config_file) for this server, which defines the usernames and code for the bots for this server. The default is to use the shipped default bot config file, which defines an [OKBot](#okbot) named `ok` and a [DoNothingBot](#donothingbot) named `null`.

### Config file

The config file defines the bots provided by this server.

The config file is implemented as a JavaScript module. It should export a single object mapping a string name for the bot to an instance of a classes that implements the [Bot](#bot) interface.

For example, the default config file declares two bot accounts: an [OKBot](#okbot) named `ok` and a [DoNothingBot](#donothingbot) named `null`.

```js
import DoNothingBot from '../lib/bots/donothing.js'
import OKBot from '../lib/bots/ok.js'

export default {
  ok: new OKBot('ok'),
  null: new DoNothingBot('null')
}
```

### Pre-installed bot classes

The following bot classes are pre-installed with the server.

#### OKBot

An *OKBot* instance will reply to any message that it's mentioned in with the constant string 'OK'.

#### DoNothingBot

A *DoNothingBot* instance will only do default stuff, like accepting follows.

## API

New bot classes must implement the [Bot](#bot) interface, which is easiest if you inherit from the `Bot` class. Bots will receive a [BotContext](#botcontext) object at initialization. The BotContext is the main way to access data or execute activities.

### Bot

The Bot interface has the following methods.

#### constructor (username)

The constructor; receives the `username` by default. Initialization should probably be deferred to the initialize() method. The default implementation stores the username.

#### async initialize (context)

Initializes the bot with the given [BotContext](#botcontext). The default implementation stores the context for later use.

#### get fullname ()

A [getter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/get) for the full name of the bot.

#### get description ()

A [getter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/get) for the bio of the bot.

#### get username ()

A [getter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/get) for the username of the bot. Should match the constructor argument.

#### get _context ()

A protected [getter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/get) for the context of the bot. (The default implementation stashes the context in a private variable, so this protected
getter is needed to retrieve it.)

#### async onMention (object, activity)

Called when the bot is mentioned in an incoming object. Can be used to implement conversational interfaces. `object` is the object of a `Create` activity, like a `Note`, that mentions the bot; it's represented in [activitystrea.ms](#activitystreams) format. `activity` is the activity itself.

### BotContext

This is the bot's control panel for working with the rest of the server.

#### get botID ()

Returns the username of the bot this context was created for.

#### get logger ()

A [pino](https://getpino.io/) [Logger](https://getpino.io/#/docs/api?id=logger) instance to use for logging messages.

#### async setData (key, value)

There's a simple key-value data store for bots to keep private data. `key` must be a string (max 512 characters); `value` is any JavaScript value that can be serialized as JSON using [JSON.stringify()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify).

#### async getData (key)

Returns the data previously stored for this key. If it doesn't exist, throws a `NoSuchValueError`. Use `hasData(key)` to check for existence.

#### async deleteData (key)

Deletes the data stored for this key. There's no backup; it's just gone.

#### async hasData (key)

Checks to see if any data has been previously stored with this key; returns a boolean.

#### async getObject (id)

Given an [ActivityPub object identifier](https://www.w3.org/TR/activitypub/#obj-id), returns an [activitystrea.ms](#activitystreams) object.

#### async sendNote (content, { to, cc, bto, bcc, audience, inReplyTo, thread, context, conversation })

Sends an Activity Streams `Note` with the given `content`. The content will be converted to HTML safely, and transformed according to social microtext rules:

- `@username@server.example`: transformed into a link to a user, and a `Mention`
- `#hashtag`: transformed into a hashtag link, and a `Hashtag` is added to the Note object
- `https://example.com/` : transformed into a link

The optional additional parameters are strings used for ActivityPub properties of the object:

- `to`, `cc`, `bto`, `bcc`, `audience`: addressing properties
- `inReplyTo`: the object the note is in reply to
- `thread`, `context`, `conversation`: the thread the object is in

#### async sendReply (content, object)

A shortcut for sending a reply with `content` to the `object`. Extracts and configures the right addressing properties and threading properties from `object`, and passes them to `sendNote()`.

#### async likeObject (obj)

Sends a `Like` activity for the passed-in object in [activitystrea.ms](#activitystreams) form.

#### async unlikeObject (obj)

Sends an `Undo`/`Like` activity for the passed-in object in [activitystrea.ms](#activitystreams) form which was previously liked.

#### async followActor (actor)

Sends a `Follow` activity for the passed-in actor in [activitystrea.ms](#activitystreams) form.

#### async unfollowActor (actor)

Sends an `Undo`/`Follow` activity for the passed-in actor in [activitystrea.ms](#activitystreams) form.

#### async blockActor (actor)

Sends a `Block` activity for the passed-in actor in [activitystrea.ms](#activitystreams) form.

#### async unblockActor (actor)

Sends an `Undo`/`Block` activity for the passed-in actor in [activitystrea.ms](#activitystreams) form.

#### async toActorId (webfinger)

Gets the `id` of the [ActivityPub Actor](https://www.w3.org/TR/activitypub/#actors) with the given [WebFinger](https://en.wikipedia.org/wiki/WebFinger) identity.

#### async toWebfinger (actorId)

Gets the [WebFinger](https://en.wikipedia.org/wiki/WebFinger) identity of the [ActivityPub Actor](https://www.w3.org/TR/activitypub/#actors) with the given `id`.

### activitystrea.ms

Activity Streams 2.0 objects are represented internally as [activitystrea.ms](https://www.npmjs.com/package/activitystrea.ms) library objects.

## Contributing

PRs accepted.

JavaScript code should use [JavaScript Standard Style](https://standardjs.com).

There is a test suite using the Node [test runner](https://nodejs.org/api/test.html#test-runner). If you add a new feature, add tests for it. If you find a bug and fix it, add a test to make sure it stays fixed.

If editing the Readme, please conform to the [standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

Copyright (C) 2023-2026 Evan Prodromou <evan@prodromou.name>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
