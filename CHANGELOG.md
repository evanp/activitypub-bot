# Changelog

All notable changes to this project will be documented in this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.44.0] - 2026-04-22

- Add `nodeinfo` route with minimal required information

## [0.43.3] - 2026-04-22

- `Digest:` header uses uppercase name for algorithm. It's supposed to be
  case-insensitive per RFC 3230, but some software compares it case-sensitive
  against uppercase.

## [0.43.2] - 2026-04-22

### Fixed

- `ActivityPubClient.post()` now re-sends the original activity JSON when
  falling back from RFC 9421 to draft-cavage-12. A variable-shadowing bug
  caused the retry to POST the error response body from the failed RFC 9421
  attempt (e.g. `{"error":"missing signature header"}`) instead of the
  original activity, which remote servers then rejected with `400 "no actor
  in message"`.

## [0.43.1] - 2026-04-22

### Fixed

- `ActivityPubClient` now falls back from RFC 9421 to draft-cavage-12
  signatures on `400`, `401`, or `403` responses (previously only 401 and
  403), so remote servers that reject RFC 9421 with a 400 — e.g.
  Pleroma-Relay's `"missing signature header"` — now trigger the
  double-knock instead of failing the request.
- Signature-policy caching is no longer overeager: successful RFC 9421
  requests no longer store a per-origin policy, and only confirmed
  draft-cavage-12 fallbacks are cached. This prevents origins whose
  public endpoints don't actually verify signatures (e.g. public
  actor fetches) from pinning the wrong scheme.
- Fallback on auth-shaped errors now also fires when the stored policy
  is the legacy `rfc9421` value, so existing caches from earlier
  releases self-correct on their next failure.

## [0.43.0] - 2026-04-22

### Added

- Top-level exports for `LitePubRelayClientBot` and `LitePubRelayServerBot`
  from `@evanp/activitypub-bot`.
- Back-compat aliases `RelayClientBot` and `RelayServerBot`, each re-exported
  as the corresponding Mastodon relay class.
- README documentation for the `--allow-private`, `--redis-url`, and
  `--trust-proxy` command-line options.
- README sections for `BotContext.duplicate()`, `updateNote()`, `deleteNote()`,
  `getFollowersId()`, `isFollower()`, `isFollowing()`, `isPendingFollowing()`,
  `followers()`, `following()`, `isLocal()`, and `onIdle()`.

### Changed

- `.markdownlint.json` disables `MD013` inside code blocks so the CLI
  help-output block can include longer option descriptions verbatim.
- README now documents `Bot.actorOK()` with its actual `actorId` parameter
  name, and `BotContext.announceObject()` with its optional `actors` argument.
- `get botID ()` in the README was a typo for `get botId ()`; corrected.

## [0.42.1] - 2026-04-22

### Added

- `CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
  format.
- `CODE_OF_CONDUCT.md`.
- `.markdownlint.json` with `MD024` set to `siblings_only` to allow repeated
  `### Added`/`### Fixed` subheadings per release.

### Fixed

- Flaky `retries distribution to a flaky recipient` test waits on
  `distributor.onIdle()` instead of a fixed 2-second timeout.

## [0.42.0] - 2026-04-22

### Added

- `LitePubRelayClientBot`, a functional LitePub relay client.
- `BotContext.followers()` and `BotContext.following()` async iterators.
- Additional `BotContext` introspection methods to support relay client bots.
- `actorType` getter on `Bot` so subclasses can override their declared
  actor type.
- `relayForwarding` option on `LitePubRelayServerBot`.
- Dedicated `LitePubRelayServerBot` separate from the Mastodon-style server.

### Changed

- Relay client/server code split into Mastodon- and LitePub-specific classes.
- Lower retention for the duplicate-activity cache.
- Bumped `mysql2`, `nanoid`, and `redis` dependencies.

## [0.41.3] - 2026-04-21

Hot patch on the `stable` branch.

### Fixed

- Errors in `DistributionWorker` are now logged instead of swallowed.

## [0.41.2] - 2026-04-13

### Fixed

- `SafeAgent` calls `super.createConnection()` correctly.

## [0.41.1] - 2026-04-13

### Fixed

- `trust proxy 1` is interpreted as `1` (integer) so Express parses
  `X-Forwarded-*` correctly.

## [0.41.0] - 2026-04-13

### Added

- `trust proxy` enabled in Express.

## [0.40.2] - 2026-04-13

### Fixed

- Correct `redis-url` handling in `activitypub-bot.js`.
- Missing `profile-file` option wired through.

## [0.40.1] - 2026-04-13

### Fixed

- Conflicts in integration tests.

## [0.40.0] - 2026-04-13

### Added

- Integration test before release.
- Optional Redis backend for rate-limit storage.
- Rate limiting on GET and POST with standard `RateLimit-*` headers.
- Request timeout, maximum size, and maximum redirects for outbound requests.
- Optional allowance of requests to private IP addresses (off by default).
- `SafeAgent` performs connection-time private-IP checks to protect
  against SSRF in `ActivityPubClient`.

### Changed

- Renamed `RateLimiter` to `RequestThrottler` to reflect its role more
  accurately.
- `http:` URLs and private-IP hosts are rejected unless explicitly allowed.

### Fixed

- Explicit handling of duplicate `resource` parameters on the Webfinger
  endpoint.

## [0.39.6] - 2026-04-11

### Fixed

- Validate only minimal derived components when checking a signature.

## [0.39.5] - 2026-04-11

### Fixed

- Only include `@method` and `@target-uri` when signing.

## [0.39.4] - 2026-04-10

### Changed

- More debugging and error reporting in `ActivityPubClient`.

## [0.39.3] - 2026-04-10

### Changed

- Extra debug output for failed RFC 9421 signatures.

## [0.39.2] - 2026-04-10

### Fixed

- Send `Content-Digest` (not `Digest`) when signing with RFC 9421.

## [0.39.1] - 2026-04-10

### Fixed

- Corrected HTTP error code type in `DistributionWorker`.
- Logger attributes now include the class name.

## [0.39.0] - 2026-04-10

### Added

- RFC 9421 HTTP Message Signatures on outbound `POST` requests.
- Double-knock in `ActivityPubClient.get()`: fall back to draft-cavage-12
  after an RFC 9421 auth failure and cache the per-origin policy.
- `SignaturePolicyStorage` backs the cached per-origin signature policy.
- Remote objects are resolved through a cached proxy when direct load fails.

### Changed

- Prefer FEP-C180 problem details on error responses; fall back to
  default problem details otherwise.
- `app` wires up `ActivityPubClient` with `messageSigner` and `policyStore`.

## [0.38.4] - 2026-04-07

### Fixed

- Pre-cache expired context `https://w3id.org/identity/v1`.

## [0.38.3] - 2026-04-07

### Added

- Pre-cached DID, security, and GoToSocial contexts.
- `X-Powered-By` header removed from responses.
- Structured logging replaces template-literal log lines.
- Request-ID propagated into per-request log entries.

## [0.38.2] - 2026-04-07

### Fixed

- Special-case two objects with the same ID where one is a
  `CryptographicKey`, in `ActivityPubClient.#resolveObject`.

## [0.38.1] - 2026-04-07

### Removed

- `p-queue` dependency (no longer needed).

## [0.38.0] - 2026-04-07

### Added

- `X-Request-ID` middleware to track requests end-to-end.

### Fixed

- Honor the `Date:` header in the `HTTPMessageSignature` validation branch.

## [0.37.1] - 2026-04-04

### Fixed

- Better handling of derived components in `HTTPMessageSignature`.

## [0.37.0] - 2026-04-04

### Added

- `HTTPMessageSignature` class implementing RFC 9421.
- Signature authenticator accepts RFC 9421 message signatures alongside
  draft-cavage.
- `HTTPMessageSignature.created()` helper.
- `Digester.contentDigest()` for RFC 9421 `Content-Digest`.

### Fixed

- Use a regex rather than naive `split()` when parsing `Signature-Input`.
- Pass full URL to `HTTPMessageSignature.validate()`.

## [0.36.2] - 2026-04-02

### Fixed

- Dropped the single-item `alsoKnownAs` value that was triggering a Misskey bug.

## [0.36.1] - 2026-04-01

### Fixed

- Cache headers correctly when the stored data is null.

## [0.36.0] - 2026-03-31

### Added

- `RemoteObjectCache` class with conditional refresh (`If-None-Match`,
  `If-Modified-Since`).
- `ActivityPubClient` requires and uses `RemoteObjectCache`.
- `app` wires `RemoteObjectCache` into the client.

### Changed

- Refactored common logic in `ActivityPubClient.#get()`.

## [0.35.0] - 2026-03-30

### Added

- `DistributionWorker`, `DeliveryWorker`, and `FanoutWorker` as
  subclasses of a shared `Worker` base.
- `IntakeWorker` processes shared-inbox intake as a background job.
- Activity fan-out moved to its own queue.
- Command-line options documented in the README.

### Changed

- Default page size raised from 20 to 256.
- Slightly better logging for follows.

## [0.34.1] - 2026-03-29

### Changed

- Dependency bumps only (no user-visible changes).

## [0.34.0] - 2026-03-29

### Added

- Workaround to accept `Follow` activities that omit addressing.
- Guess Mastodon's 300 requests / 5 minutes rate-limit policy when no
  headers are present.
- Peek at current rate-limit values.

### Changed

- `pendingFollowing` consistently stores activities, not actors.

### Removed

- References to the unused `pendingFollowers` collection.

### Fixed

- `ActivityHandler.#handleBlock()` checks for a pending follow activity
  rather than a pending actor.
- Correct handling of pending follow activity during actor block.
- Test for unfollow correctly uses `pendingFollowing` in `BotContext`.

## [0.33.0] - 2026-03-26

### Added

- Webfinger lookup for profile pages.

### Changed

- Grudgingly accept the default namespace for security-namespace
  properties when fetching keys and actors.

### Removed

- Dead code path for fetching remote public keys in `RemoteKeyStorage`.

### Fixed

- Confirm the owner of a remote public key before trusting it.

## [0.32.3] - 2026-03-24

### Fixed

- Fail fast on unrecoverable server errors.
- Respect `Retry-After` delay on 500-class errors when specified.

## [0.32.2] - 2026-03-24

### Added

- More robust distribution behavior.
- Retry after distribution on 429 errors.

## [0.32.1] - 2026-03-24

### Added

- Archive failed jobs to a `failed_job` table.

### Fixed

- `DistributionWorker` now fails jobs on unrecoverable errors.

## [0.32.0] - 2026-03-24

### Added

- Profile page route for bots (`/profile/{botid}`).
- Custom icon and image for bots.
- Profile page link in Webfinger output.
- URL property on the actor pointing at the profile page.
- Discovery link on the profile page.
- `UrlFormatter.formatProfile()` and companion format/unformat methods
  for icon and image.

### Changed

- Profile page centered in body. (#154)

### Fixed

- Count of links in Webfinger results.

## [0.31.1] - 2026-03-22

### Changed

- Block activities with no `id` from the shared inbox.

### Fixed

- Reject activities with no `id` at the inbox.

## [0.31.0] - 2026-03-22

### Added

- Dedicated server actor bot; routes, Webfinger, and documentation
  updated accordingly.
- `DoNothingBot` accepts custom parameters.
- Bots can declare whether they need HTTP signature verification.
- `UrlFormatter` exposes a `hostname` getter.

### Changed

- `ActivityPubClient` uses the server actor for signed key-fetch
  requests; no special-case.
- Server actor ID is now derived from the domain name.

### Removed

- Server special case in Webfinger routes and unused server routes.
- HTTP-signature check for server actor, Webfinger, and health endpoints.

### Fixed

- `KeyStorage` no longer accepts `null` username.
- Don't verify signatures for the server actor itself.

## [0.30.6] - 2026-03-21

### Fixed

- Skip HTTP-signature verification for server, Webfinger, and health endpoints.

## [0.30.5] - 2026-03-21

### Added

- Rate-limit header parsing supports either dates or integers.

## [0.30.4] - 2026-03-21

### Fixed

- Correct protocol for homepage URL.

## [0.30.3] - 2026-03-21

### Added

- `name` on server actor.

## [0.30.2] - 2026-03-21

### Fixed

- Correct `preferredUsername` for server actor.

## [0.30.1] - 2026-03-21

### Fixed

- Wait test for `ActivityPubClient`.

## [0.30.0] - 2026-03-21

### Changed

- Rate limiter switched to a greedy algorithm.
- More logging info on failed requests.

### Fixed

- Additional reference fixes for `ActivityHandler.#doActivity()`.
- Errors in reply and follow handling.
- Don't expose `botId '*'` publicly in `BotContext`.
- More robust argument checks in `ActivityPubClient`.
- Argument checks in `KeyStorage`.

## [0.29.0] - 2026-03-19

### Added

- Webfinger routes for both bot actors and the server actor.
- HTTPS Webfinger support.
- `UrlFormatter.acct()` for `acct:` URI formatting.

## [0.28.7] - 2026-03-19

### Fixed

- Larger body-size limit for incoming JSON data.

## [0.28.6] - 2026-03-19

### Fixed

- Support `keyId` with a parameter in the signature header.

## [0.28.5] - 2026-03-18

### Added

- More logging in `HTTPSignatureAuthenticator`.
- More robust handling of server responses.

## [0.28.4] - 2026-03-18

### Added

- Better handling of fragment URIs in `ActivityPubClient`.

## [0.28.3] - 2026-03-18

### Added

- Embed `publicKey` in the server actor.

## [0.28.2] - 2026-03-18

### Fixed

- Rate-limit test epsilon consistent everywhere.

## [0.28.1] - 2026-03-18

### Fixed

- Grow the epsilon for the `ActivityPubClient` test.

## [0.28.0] - 2026-03-18

### Changed

- Server actor moved to `/actor`.

## [0.27.1] - 2026-03-17

### Fixed

- More breathing room in the rate-limit test.

## [0.27.0] - 2026-03-17

### Added

- `ActivityPubClient` respects rate limits via a `RateLimiter` argument.
- `RateLimiter` class.

## [0.26.3] - 2026-03-17

### Fixed

- Better handling of `Accept` header for root URL.

## [0.26.2] - 2026-03-17

### Fixed

- Better error when a key is not found.

## [0.26.1] - 2026-03-17

### Fixed

- Timestamps on collections.

## [0.26.0] - 2026-03-17

### Changed

- `BotContext.announceObject()` takes an `actors` argument.

### Fixed

- Better handling of objects without owners or names.

## [0.25.1] - 2026-03-17

### Fixed

- `BotFactory` also supports `actorOK()`.
- Relay client deletes the follow activity instead of setting it to null.

## [0.25.0] - 2026-03-16

### Added

- `FollowBackBot` that follows back automatically and undoes its follow
  when unfollowed.
- Undo-Follow callback on the `Bot` interface.
- `BotContext` silently succeeds on duplicate follow.

### Changed

- Exported `FollowBackBot`.

## [0.24.2] - 2026-03-12

### Added

- Handle `Accept` and `Reject` for relay follow activities.

## [0.24.1] - 2026-03-12

### Fixed

- Send the full `Public` URL for relay follow/unfollow.
- Log at `info` instead of `debug` in relay client.

## [0.24.0] - 2026-03-11

### Added

- Unsubscribe from relay (#91).

## [0.23.0] - 2026-03-11

### Added

- Configurable worker counts and index file.
- Command-line script covered by tests.
- Documentation for delivery, distribution, and the index file.

### Changed

- Default distribution worker count is now 8.

## [0.22.0] - 2026-03-11

### Added

- Index page. (#118)

### Changed

- `makeApp()` takes keyword arguments.

## [0.21.2] - 2026-03-09

### Added

- Reaper for stalled/crashed jobs; releases stalled jobs back to the queue.
- Wake sleeping workers when a new job is enqueued.

### Changed

- Better handling of collections as recipients in `Authorizer`.
- Better locking for Postgres in `JobQueue`.
- Database errors bubble up.

### Fixed

- Correct retry behaviour.
- Await delivery properly.
- Use workers in tests.
- Better queue handling in `activityhandler.test.js`.
- `app` wires `jobQueue` and `distributionWorkers` correctly.

## [0.21.1] - 2026-02-25

### Fixed

- Correct `summary` property. (#119)

## [0.21.0] - 2026-02-18

### Added

- Persistent job queue backed by the database.
- `DistributionWorker` class.
- `DeliveryWorker` for local delivery.
- Retry after a period of time.
- `IntakeWorker` for shared-inbox intake.
- Distribute public activities to the bot inbox as well as the shared
  inbox (with deduplication).

### Changed

- Single queue used by `ActivityDistributor`.

### Removed

- Unused properties and constants from `ActivityDeliverer`.

## [0.20.1] - 2026-02-18

### Fixed

- Description for relay server.

## [0.20.0] - 2026-02-18

### Added

- Export `RelayClientBot` and `RelayServerBot`.

## [0.19.0] - 2026-02-17

### Changed

- Large test-suite cleanup: database isolation, cleanup helpers, unique
  hostnames across tests.
- Consistent lowercase aliases in `ActorStorage` and `ObjectStorage`
  queries for Postgres/SQLite compatibility.

### Fixed

- Better table-existence check for Postgres.
- Postgres migrations run inside a lock to prevent conflicts.
- SQLite-memory URL no longer used (broke in Node 25).
- `ActorStorage` handles mixed-case and lowercase keys.

## [0.18.0] - 2026-02-10

### Added

- Accept `hs2019` HTTP signatures.

## [0.17.0] - 2026-02-10

### Added

- `RelayServerBot` class.
- `Bot.handleActivity()` hook to skip default activity handling.
- `BotContext.doActivity()` method.
- `RelayClientBot`.
- Bots can allowlist specific HTTP-signature authors.

### Fixed

- Prevent duplicate relay clients.
- Better debug output for `app.onIdle()`.
- Always lower-case `type` in the URL formatter.

## [0.16.7] - 2026-01-30

### Added

- More info included on Undo activities.

## [0.16.6] - 2026-01-28

### Fixed

- Correct recipients of Undo-Announce.

## [0.16.5] - 2026-01-28

### Changed

- Refactored `BotContext.#undoActivity()` for clarity.

## [0.16.4] - 2026-01-28

### Fixed

- Use bot key as username.

## [0.16.3] - 2026-01-28

### Fixed

- Stray include in `ActorStorage`.

## [0.16.2] - 2026-01-28

### Removed

- Stray `console.log()`.

## [0.16.1] - 2026-01-28

### Fixed

- Debug logging in `botcontext.test.js`.

## [0.16.0] - 2026-01-28

### Added

- `BotContext.unannounceObject(obj)`.
- `lastactivity` table for efficient undos.
- `ActorStorage` last-activity helpers.

### Changed

- Refactored `BotContext` to send activities via a helper and look up
  the most recent activity for undos.

## [0.15.4] - 2026-01-27

### Fixed

- Error when filtering pages containing a single item.

## [0.15.3] - 2026-01-26

### Fixed

- `package-lock.json`.

## [0.15.2] - 2026-01-26

### Fixed

- `package-lock.json` version.

## [0.15.1] - 2026-01-26

### Fixed

- `package.json` entry for `activitypub-nock`.

## [0.15.0] - 2026-01-26

### Added

- Deliver to remote collections (`followers`, `following`, generic).
- Distribute to local collections.

## [0.14.2] - 2026-01-25

### Fixed

- Skip items in a collection where the read-access check errors.

## [0.14.1] - 2026-01-25

### Fixed

- Better format for `shares` collection `Add`.

## [0.14.0] - 2026-01-25

### Added

- Correctly generate an `Add` activity when an object is liked.

### Changed

- Use 202 Accepted for inbox responses.
- `ActivityDeliverer` uses a queue for delivery.

### Fixed

- More robust behavior when local objects contain bad data.

## [0.13.14] - 2026-01-23

### Changed

- Nock helpers extracted into the `@evanp/activitypub-nock` package for re-use.

## [0.13.13] - 2026-01-22

### Changed

- `#doActivity()` sets `actor`, `id`, `published`, and `updated`.

### Fixed

- Fall back to the user in URL as owner if it's a local object.

## [0.13.12] - 2026-01-22

### Fixed

- More robust bot-actor generation.

## [0.13.11] - 2026-01-22

### Fixed

- Don't redeliver an activity that's already in the inbox.

## [0.13.10] - 2026-01-22

### Added

- Better handling of null key material in the database.

## [0.13.9] - 2026-01-22

### Fixed

- `bot.ok.test` no longer depends on ordering.

## [0.13.8] - 2026-01-22

### Added

- More debug logging for `OKBot`.

## [0.13.7] - 2026-01-22

### Added

- More logging during activity delivery.

## [0.13.6] - 2026-01-22

### Added

- Logging for received activities.

## [0.13.5] - 2026-01-22

### Fixed

- `KeyStorage` uses a zero-length string for the system key.

## [0.13.4] - 2026-01-22

### Fixed

- `OKBot` works in the public inbox context.

## [0.13.3] - 2026-01-22

### Fixed

- Symlink global libs into `/app/` inside Docker.

## [0.13.2] - 2026-01-22

### Fixed

- Path issues in Dockerfile.

## [0.13.1] - 2026-01-22

### Added

- `.npmignore` to exclude unnecessary files.

### Fixed

- Proper path for the `activitypub-bot` script.

## [0.13.0] - 2026-01-22

### Added

- Default bot classes exported from the library.

### Fixed

- Workaround for Express 5 disallowing regexes in routes.

## [0.12.1] - 2026-01-21

### Fixed

- Default bots file wired up from `bin`.

## [0.12.0] - 2026-01-21

### Changed

- Simplified Dockerfile.
- Reorganized top-level scripts and packaged the library.

## [0.11.0] - 2026-01-21

### Added

- `BotContext.announceObject()`.
- `onAnnounce()` callback when an actor's object is shared (#56).
- Thread-context registration for performance.
- Deliver to local members of a remote collection through the shared inbox.
- `ActivityPubClient.items(collection)` async iterator for paged and
  ordered collections.

### Changed

- Express bumped from 4.x to 5.x.

### Fixed

- Better handling of `null` in `KeyStorage`.

## [0.10.0] - 2026-01-15

### Added

- Handle public messages.
- Delivery to followers via shared inbox.
- `sharedInbox` endpoint on the actor.
- Utility to look up usernames that have a given item in a collection.
- Deliver activities to local `followers` and `following` collections.
- Delivery to remote `following` collections.
- Webfinger lookup tools in `BotContext`.
- `BotContext.sendReply()`.
- Microsyntax transformation (hashtags, URLs, mentions) in `BotContext`.

### Changed

- Six delivery cases rationalized: public, local actor, local collection,
  remote actor, remote collection, other.
- Delivery code moved into `ActivityDeliverer`.

### Fixed

- `ActivityDistributor` won't distribute an activity back to the actor.
- Correct type for `Hashtag` in microsyntax.

## [0.9.0] - 2026-01-10

### Added

- `thread` and thread-page routes.
- Thread collection management for remote objects.
- `BotContext.duplicate()`.
- `BotFactory` support for dynamically-provisioned bots: actor routes,
  collections, public key, and inbox handling.
- FEP-5711 inverse properties (`replies`, `likes`, `shares`) on actors
  and new content.

### Fixed

- Conversation tracking in replies.
- Reactions and thread on new content.
- `inReplyTo` for OK bot.
- Correct origin in `actorstorage.test.js`.
- `UrlFormatter.getUserName()` uses `unformat()`.

## [0.8.0] - 2025-09-13

### Added

- Inverse properties on `replies`, `likes`, and `shares`.

## [0.7.5] - 2025-06-03

### Fixed

- Don't handle the same activity a second time.

## [0.7.4] - 2025-06-03

### Changed

- Additional error checks on collection operations.

## [0.7.3] - 2025-06-03

### Fixed

- Outbox route when it contains activities.

## [0.7.2] - 2025-06-03

### Fixed

- `Authorizer.canRead()` checks for object and object.id.
- `HTTPSignature` uses query params when building the signing string.
- Silent logger for `HTTPSignature`.
- `HTTPSignature` handles URLs with parameters.

## [0.7.1] - 2025-05-23

### Fixed

- Quietly fail when delivering to actors with no inbox.

## [0.7.0] - 2025-05-22

### Added

- `OKBot` replies at most once to a mention.
- `BotContext.hasData()`.
- Logger on `BotContext`.
- Logging in `OKBot`.
- Class name in logger output.

## [0.6.0] - 2025-05-22

### Added

- Robustness to key rotation.
- Option to skip the cache in `RemoteKeyStorage`.

### Fixed

- Future and past dates.

## [0.5.7] - 2025-05-17

### Fixed

- `OKBot` mentions the sender correctly.

## [0.5.6] - 2025-05-17

### Fixed

- Better table and queries for `RemotePublicKey`.
- Actually save local public and private keys.

## [0.5.5] - 2025-05-17

### Added

- Log public/private key access.

### Fixed

- Trim `target` and `host` in `HTTPSignature`.

## [0.5.4] - 2025-05-16

### Changed

- Use a list for headers in `HTTPSignature` to make signing replicable.
- Better escaping and trimming in `HTTPSignature`.

## [0.5.3] - 2025-05-16

### Fixed

- Digester test regression.

## [0.5.2] - 2025-05-16

### Fixed

- Signature-header match regex in tests.

## [0.5.1] - 2025-05-16

### Added

- Packaging fixes for the signing work in 0.5.0.

## [0.5.0] - 2025-05-16

### Added

- Sign `Accept`, `Content-Type`, and `User-Agent` headers.

## [0.4.10] - 2025-05-16

### Added

- More HTTP-signature debugging output.

## [0.4.9] - 2025-05-15

### Added

- Debug output for HTTP signatures.

## [0.4.8] - 2025-05-14

### Changed

- All HTTP-signature and digest methods consolidated into dedicated modules.

## [0.4.7] - 2025-05-14

### Changed

- Compare digest algorithms case-independently.

## [0.4.6] - 2025-05-14

### Fixed

- Better handling of key IDs with a fragment.

## [0.4.5] - 2025-05-13

### Added

- Better error reporting in the distributor.
- Log bad incoming activities.

## [0.4.4] - 2025-05-13

### Fixed

- Better `Digest` and `Date` validation, with better error messages.

## [0.4.3] - 2025-05-13

### Fixed

- Bad `Digest` value on outgoing HTTP requests.

## [0.4.2] - 2025-05-13

### Fixed

- Correct method in POST signature.

## [0.4.1] - 2025-05-13

### Fixed

- Common logger used for `ActivityDistributor`.

## [0.4.0] - 2025-05-13

### Added

- `LOG_LEVEL` environment variable.

### Fixed

- Better handling of remote keys with their own URL.
- Use `CryptographicKey` rather than `PublicKey`.

## [0.3.4] - 2025-05-13

### Fixed

- Client doesn't sign requests for HTTP-signature keys unless necessary.

## [0.3.3] - 2025-05-12

### Fixed

- Webfinger endpoint works correctly.

## [0.3.2] - 2025-05-12

### Fixed

- Copy `lib` and `bots` to the correct directories in Docker.
- Multiplatform Docker image.

## [0.3.1] - 2025-05-12

### Fixed

- Copy `bots` directory in Docker.

## [0.3.0] - 2025-05-12

### Added

- Standard bot classes and a new bot architecture.
- Start script.

## [0.2.0] - 2025-05-11

### Added

- Docker image built on tag.
- `/livez` and `/readyz` health-check routes.

## [0.1.0] - 2025-05-10

### Added

- Initial release: ActivityPub bot framework with Webfinger, actor
  routes, inbox/outbox, shared inbox, HTTP Signatures, object and actor
  storage, key storage, bot context API, activity distribution, and
  default bots (`OKBot`, `DoNothingBot`).
- Sequelize drivers for SQLite, Postgres, and MySQL.
- Docker multi-platform build workflow.
- Dependabot configuration.
