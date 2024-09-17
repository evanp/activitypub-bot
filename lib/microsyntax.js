import assert from 'node:assert'
import fetch from 'node-fetch'

const AS2 = 'https://www.w3.org/ns/activitystreams#'

export class Transformer {
  #tagNamespace = null
  #client = null
  constructor (tagNamespace, client) {
    this.#tagNamespace = tagNamespace
    this.#client = client
    assert.ok(this.#tagNamespace)
    assert.ok(this.#client)
  }

  async transform (text) {
    let html = text
    let tag = [];
    ({ html, tag } = this.#replaceUrls(html, tag));
    ({ html, tag } = this.#replaceHashtags(html, tag));
    ({ html, tag } = await this.#replaceMentions(html, tag))
    html = `<p>${html}</p>`
    return { html, tag }
  }

  #replaceUrls (html, tag) {
    const url = /https?:\/\/\S+/g
    const segments = this.#segment(html)
    for (const i in segments) {
      const segment = segments[i]
      if (this.#isLink(segment)) continue
      segments[i] = segment.replace(url, (match) => {
        return `<a href="${match}">${match}</a>`
      })
    }
    return { html: segments.join(''), tag }
  }

  #replaceHashtags (html, tag) {
    const hashtag = /#(\w+)/g
    const segments = this.#segment(html)
    for (const i in segments) {
      const segment = segments[i]
      if (this.#isLink(segment)) continue
      segments[i] = segment.replace(hashtag, (match, name) => {
        const href = this.#tagNamespace + name
        tag.push({ type: 'Hashtag', name: match, href })
        return `<a href="${href}">${match}</a>`
      })
    }
    return { html: segments.join(''), tag }
  }

  async #replaceMentions (html, tag) {
    const self = this
    const webfinger = /@[a-zA-Z0-9_]+([a-zA-Z0-9_.-]+[a-zA-Z0-9_]+)?@[a-zA-Z0-9_.-]+/g
    const segments = this.#segment(html)
    for (const i in segments) {
      const segment = segments[i]
      if (this.#isLink(segment)) continue
      segments[i] = await this.#replaceAsync(segments[i], webfinger, async (match) => {
        const href = await self.#homePage(match.slice(1))
        if (!href) return match
        tag.push({ type: 'Mention', name: match, href })
        return `<a href="${href}">${match}</a>`
      })
    }
    return { html: segments.join(''), tag }
  }

  async #homePage (webfinger) {
    if (!this.#client) return null
    const [username, domain] = webfinger.split('@')
    const url = `https://${domain}/.well-known/webfinger?` +
      `resource=acct:${username}@${domain}`
    let json = null
    try {
      const response = await fetch(url,
        { headers: { Accept: 'application/jrd+json' } })
      if (response.status !== 200) return null
      json = await response.json()
    } catch (error) {
      return null
    }
    if (!json.links) return null
    const link = json.links.find(
      link => link.rel === 'self' &&
        (link.type === 'application/activity+json' ||
          link.type === 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'))
    if (!link) return null
    const actorId = link.href
    if (!actorId) return null
    let actor = null
    try {
      actor = await this.#client.get(actorId)
    } catch (error) {
      console.error(error)
      return null
    }
    if (!actor) return null
    if (!actor.url) {
      return actorId
    }
    for (const url of actor.url) {
      if (url.type === AS2 + 'Link' &&
        url.mediaType === 'text/html' &&
        url.href) {
        return url.href
      }
    }
    // Fallback to first URL
    if (actor.url.length === 1 && !actor.url.first.type) {
      return actor.url.first.id
    }
    // Fallback even further to actor ID
    return actorId
  }

  #isLink (segment) {
    return (segment.startsWith('<a>') || segment.startsWith('<a ')) && segment.endsWith('</a>')
  }

  #segment (html) {
    return html.split(/(<[^>]+>[^<]+<\/[^>]+>)/)
  }

  async #replaceAsync (str, regex, asyncFn) {
    const promises = []
    str.replace(regex, (match, ...args) => {
      // Add a promise for each match
      promises.push(asyncFn(match, ...args))
    })

    // Wait for all async replacements to resolve
    const replacements = await Promise.all(promises)

    // Replace the matches with their respective replacements
    return str.replace(regex, () => replacements.shift())
  }
}
