import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import request from 'supertest'

const browserOrigin = 'https://browser.example'

function assertOrigin (response, origin, restricted) {
  const allowed = response.headers['access-control-allow-origin']
  assert.equal(allowed, restricted ? origin : '*')
}

export function corsTests (getApp, getCases, { origin = browserOrigin, restricted = false } = {}) {
  describe('CORS', () => {
    for (const route of getCases()) {
      const { method = 'GET', status = 200, accept = 'application/activity+json', body, headers = ['accept'] } = route
      const path = () => typeof route.path === 'function' ? route.path() : route.path
      const label = route.name || (typeof route.path === 'string' ? route.path : 'collection endpoint')

      it(`${method} ${label} allows the browser to read the response`, async () => {
        let req = request(getApp())[method.toLowerCase()](path())
          .set('Origin', origin)
          .set('Accept', accept)
        if (route.requestHeaders) req = req.set(route.requestHeaders)
        if (body !== undefined) req = req.send(body)
        const response = await req
        assert.ok([status].flat().includes(response.status), `Unexpected HTTP ${response.status}`)
        assertOrigin(response, origin, restricted)
      })

      it(`OPTIONS ${label} permits ${method} and its request headers without authentication`, async () => {
        const response = await request(getApp()).options(path())
          .set('Origin', origin)
          .set('Access-Control-Request-Method', method)
          .set('Access-Control-Request-Headers', headers.join(', '))
        assert.ok(response.status >= 200 && response.status < 300, `Unexpected HTTP ${response.status}`)
        assertOrigin(response, origin, restricted)
        const methods = (response.headers['access-control-allow-methods'] || '').toUpperCase().split(/\s*,\s*/)
        assert.ok(methods.includes(method), `Preflight must allow ${method}`)
        const allowedHeaders = (response.headers['access-control-allow-headers'] || '').toLowerCase().split(/\s*,\s*/)
        for (const header of headers) {
          assert.ok(allowedHeaders.includes('*') || allowedHeaders.includes(header), `Preflight must allow ${header}`)
        }
      })
    }
  })
}
