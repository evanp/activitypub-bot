import as2 from 'activitystrea.ms'
import nock from 'nock'
import crypto from 'node:crypto'
import { promisify } from 'node:util'

const generateKeyPair = promisify(crypto.generateKeyPair)

const domains = new Map()
domains['social.example'] = new Map()

const newKeyPair = async () => {
  return await generateKeyPair(
    'rsa',
    {
      modulusLength: 2048,
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      },
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      }
    }
  )
}

export const getPair = async (username, domain = 'social.example') => {
  if (!domains.has(domain)) {
    domains.set(domain, new Map())
  }
  if (!domains.get(domain).has(username)) {
    const pair = await newKeyPair(username)
    domains.get(domain).set(username, pair)
  }
  return domains.get(domain).get(username)
}

export const getPublicKey = async (username, domain = 'social.example') => {
  const pair = await getPair(username, domain)
  return pair.publicKey
}

export const getPrivateKey = async (username, domain = 'social.example') => {
  const pair = await getPair(username, domain)
  return pair.privateKey
}

export const nockSignature = async ({ method = 'GET', url, date, digest = null, username, domain = 'social.example' }) => {
  const privateKey = await getPrivateKey(username, domain)
  const keyId = nockFormat({ username, key: true, domain })
  const parsed = new URL(url)
  const target = (parsed.search && parsed.search.length)
    ? `${parsed.pathname}?${parsed.search}`
    : `${parsed.pathname}`
  let data = `(request-target): ${method.toLowerCase()} ${target}\n`
  data += `host: ${parsed.host}\n`
  data += `date: ${date}`
  if (digest) {
    data += `\ndigest: ${digest}`
  }
  const signer = crypto.createSign('sha256')
  signer.update(data)
  const signature = signer.sign(privateKey).toString('base64')
  signer.end()
  return `keyId="${keyId}",headers="(request-target) host date${(digest) ? ' digest' : ''}",signature="${signature.replace(/"/g, '\\"')}",algorithm="rsa-sha256"`
}

export const makeActor = async (username, domain = 'social.example') =>
  await as2.import({
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    id: `https://${domain}/user/${username}`,
    type: 'Person',
    preferredUsername: username,
    inbox: `https://${domain}/user/${username}/inbox`,
    outbox: `https://${domain}/user/${username}/outbox`,
    followers: `https://${domain}/user/${username}/followers`,
    following: `https://${domain}/user/${username}/following`,
    liked: `https://${domain}/user/${username}/liked`,
    to: ['as:Public'],
    publicKey: {
      id: `https://${domain}/user/${username}/publickey`,
      type: 'CryptographicKey',
      owner: `https://${domain}/user/${username}`,
      publicKeyPem: await getPublicKey(username, domain)
    },
    url: {
      type: 'Link',
      href: `https://${domain}/profile/${username}`,
      mediaType: 'text/html'
    }
  })

// Just the types we use here
const isActivityType = (type) => ['Create', 'Update', 'Delete', 'Add', 'Remove', 'Follow', 'Accept', 'Reject', 'Like', 'Block', 'Flag', 'Undo'].includes(uppercase(type))

export const makeObject = async (username, type, num, domain = 'social.example') =>
  as2.import({
    id: nockFormat({ username, type, num, domain }),
    type: uppercase(type),
    to: 'as:Public',
    actor: (isActivityType(type) ? nockFormat({ username, domain }) : undefined),
    attributedTo: (isActivityType(type) ? undefined : nockFormat({ username, domain }))
  })

export const makeTransitive = (username, type, num, obj, domain = 'social.example') =>
  as2.import({
    id: nockFormat({ username, type, num, obj, domain }),
    type: uppercase(type),
    to: 'as:Public',
    actor: nockFormat({ username, domain }),
    object: `https://${obj}`
  })

const uppercase = (str) => str.charAt(0).toUpperCase() + str.slice(1)

export const postInbox = {}

export const nockSetup = (domain) =>
  nock(`https://${domain}`)
    .get(/^\/.well-known\/webfinger/)
    .reply(async (uri, requestBody) => {
      const parsed = new URL(uri, `https://${domain}`)
      const resource = parsed.searchParams.get('resource')
      if (!resource) {
        return [400, 'Bad Request']
      }
      const username = resource.slice(5).split('@')[0]
      const webfinger = {
        subject: resource,
        links: [
          {
            rel: 'self',
            type: 'application/activity+json',
            href: `https://${domain}/user/${username}`
          }
        ]
      }
      return [200,
        JSON.stringify(webfinger),
        { 'Content-Type': 'application/jrd+json' }]
    })
    .get(/^\/user\/(\w+)$/)
    .reply(async (uri, requestBody) => {
      const username = uri.match(/^\/user\/(\w+)$/)[1]
      const actor = await makeActor(username, domain)
      const actorText = await actor.prettyWrite(
        { additional_context: 'https://w3id.org/security/v1' }
      )
      return [200, actorText, { 'Content-Type': 'application/activity+json' }]
    })
    .persist()
    .post(/^\/user\/(\w+)\/inbox$/)
    .reply(async (uri, requestBody) => {
      const username = uri.match(/^\/user\/(\w+)\/inbox$/)[1]
      if (username in postInbox) {
        postInbox[username] += 1
      } else {
        postInbox[username] = 1
      }
      return [202, 'accepted']
    })
    .persist()
    .get(/^\/user\/(\w+)\/publickey$/)
    .reply(async (uri, requestBody) => {
      const username = uri.match(/^\/user\/(\w+)\/publickey$/)[1]
      const publicKey = await as2.import({
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1'
        ],
        id: `https://${domain}/user/${username}/publickey`,
        owner: `https://${domain}/user/${username}`,
        type: 'CryptographicKey',
        publicKeyPem: await getPublicKey(username, domain)
      })
      const publicKeyText = await publicKey.prettyWrite(
        { additional_context: 'https://w3id.org/security/v1' }
      )
      return [200, publicKeyText, { 'Content-Type': 'application/activity+json' }]
    })
    .persist()
    .get(/^\/user\/(\w+)\/(\w+)\/(\d+)$/)
    .reply(async (uri, requestBody) => {
      const match = uri.match(/^\/user\/(\w+)\/(\w+)\/(\d+)$/)
      const username = match[1]
      const type = uppercase(match[2])
      const num = match[3]
      const obj = await makeObject(username, type, num, domain)
      const objText = await obj.write()
      return [200, objText, { 'Content-Type': 'application/activity+json' }]
    })
    .persist()
    .get(/^\/user\/(\w+)\/(\w+)\/(\d+)\/(.*)$/)
    .reply(async (uri, requestBody) => {
      const match = uri.match(/^\/user\/(\w+)\/(\w+)\/(\d+)\/(.*)$/)
      const username = match[1]
      const type = match[2]
      const num = match[3]
      const obj = match[4]
      const act = await makeTransitive(username, type, num, obj, domain)
      const actText = await act.write()
      return [200, actText, { 'Content-Type': 'application/activity+json' }]
    })

export function nockFormat ({ username, type, num, obj, key, domain = 'social.example' }) {
  let url = `https://${domain}/user/${username}`
  if (key) {
    url = `${url}/publickey`
  } else {
    if (type && num) {
      url = `${url}/${type}/${num}`
      if (obj) {
        if (obj.startsWith('https://')) {
          url = `${url}/${obj.slice(8)}`
        } else {
          url = `${url}/${obj}`
        }
      }
    }
  }
  return url
}
