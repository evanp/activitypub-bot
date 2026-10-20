import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import nock from 'nock'

import as2 from '../lib/activitystreams.js'

const AS_CONTEXT = 'https://www.w3.org/ns/activitystreams'
const CID_CONTEXT = 'https://www.w3.org/ns/cid/v1'
const BLOCKED_CONTEXT = 'https://purl.archive.org/socialweb/blocked'
const EF61_CONTEXT = 'https://w3id.org/fep/ef61'
const SECURITY = 'https://w3id.org/security#'
const ACTOR_ID = 'https://activitystreams.test/actors/alice'
const contextFixtures = JSON.parse(readFileSync(new URL('./fixtures/activitystreams-contexts.json', import.meta.url)))

describe('Pre-registered Activity Streams contexts', () => {
  before(() => nock.disableNetConnect())
  after(() => nock.enableNetConnect())

  for (const fixture of contextFixtures) {
    describe(fixture.name, () => {
      for (const url of fixture.urls) {
        it(`imports ${url} offline with the source context's RDF meaning`, async () => {
          const object = await as2.import({
            '@context': [AS_CONTEXT, url],
            ...structuredClone(fixture.input)
          })

          assert.equal(await object.toRDF(), fixture.nquads)
        })
      }
    })
  }

  describe(CID_CONTEXT, () => {
    it('imports controller and verification relationships offline as references', async () => {
      const actor = await as2.import({
        '@context': [AS_CONTEXT, CID_CONTEXT],
        id: ACTOR_ID,
        type: 'Person',
        alsoKnownAs: `${ACTOR_ID}/alias`,
        controller: ACTOR_ID,
        verificationMethod: `${ACTOR_ID}#key`,
        assertionMethod: [`${ACTOR_ID}#key`, `${ACTOR_ID}#backup`],
        authentication: `${ACTOR_ID}#key`,
        capabilityDelegation: `${ACTOR_ID}#key`,
        capabilityInvocation: `${ACTOR_ID}#key`,
        keyAgreement: `${ACTOR_ID}#key`
      })

      assert.equal(actor.id, ACTOR_ID)
      assert.equal(actor.get('alsoKnownAs').first.id, `${ACTOR_ID}/alias`)
      assert.equal(actor.get(`${SECURITY}controller`).first.id, ACTOR_ID)
      assert.equal(actor.get(`${SECURITY}verificationMethod`).first.id, `${ACTOR_ID}#key`)
      assert.deepEqual(
        Array.from(actor.get(`${SECURITY}assertionMethod`), key => key.id),
        [`${ACTOR_ID}#key`, `${ACTOR_ID}#backup`]
      )
      for (const property of ['authentication', 'capabilityDelegation', 'capabilityInvocation', 'keyAgreement']) {
        assert.equal(actor.get(`${SECURITY}${property}Method`).first.id, `${ACTOR_ID}#key`)
      }
    })

    it('imports service endpoints using the scoped service context offline', async () => {
      const actor = await as2.import({
        '@context': [AS_CONTEXT, CID_CONTEXT],
        id: ACTOR_ID,
        type: 'Person',
        service: [{
          id: `${ACTOR_ID}#service`,
          serviceEndpoint: 'https://activitystreams.test/service'
        }]
      })

      const service = actor.get('https://www.w3.org/ns/did#service').first
      assert.equal(service.id, `${ACTOR_ID}#service`)
      assert.equal(service.get('https://www.w3.org/ns/did#serviceEndpoint').first.id,
        'https://activitystreams.test/service')
    })

    it('imports Multikey definitions and typed values offline', async () => {
      const actor = await as2.import({
        '@context': [AS_CONTEXT, CID_CONTEXT],
        id: ACTOR_ID,
        type: 'Person',
        verificationMethod: [{
          id: `${ACTOR_ID}#key`,
          type: 'Multikey',
          controller: ACTOR_ID,
          publicKeyMultibase: 'zExamplePublicKey',
          expires: '2030-01-01T00:00:00Z'
        }]
      })

      const key = actor.get(`${SECURITY}verificationMethod`).first
      assert.equal(key.id, `${ACTOR_ID}#key`)
      assert.equal(key.type, `${SECURITY}Multikey`)
      assert.equal(key.get(`${SECURITY}controller`).first.id, ACTOR_ID)
      assert.equal(key.get(`${SECURITY}publicKeyMultibase`).first, 'zExamplePublicKey')
      assert.deepEqual(key.get(`${SECURITY}expiration`).first, new Date('2030-01-01T00:00:00Z'))
    })

    it('preserves publicKeyJwk as JSON using the scoped JsonWebKey context offline', async () => {
      const publicKeyJwk = { kty: 'OKP', crv: 'Ed25519', x: 'example-public-key' }
      const actor = await as2.import({
        '@context': [AS_CONTEXT, CID_CONTEXT],
        id: ACTOR_ID,
        type: 'Person',
        verificationMethod: [{
          id: `${ACTOR_ID}#key`,
          type: 'JsonWebKey',
          controller: ACTOR_ID,
          publicKeyJwk
        }]
      })

      const key = actor.get(`${SECURITY}verificationMethod`).first
      assert.equal(key.type, `${SECURITY}JsonWebKey`)
      assert.equal(key.get(`${SECURITY}controller`).first.id, ACTOR_ID)
      assert.deepEqual(key.get(`${SECURITY}publicKeyJwk`).first, publicKeyJwk)
    })
  })

  describe(BLOCKED_CONTEXT, () => {
    it('imports all four blocked collection properties offline as references', async () => {
      const actor = await as2.import({
        '@context': [AS_CONTEXT, BLOCKED_CONTEXT],
        id: ACTOR_ID,
        type: 'Person',
        blocked: `${ACTOR_ID}/blocked`,
        blocks: `${ACTOR_ID}/blocks`,
        blockedOf: `${ACTOR_ID}/blockedOf`,
        blocksOf: `${ACTOR_ID}/blocksOf`
      })

      for (const property of ['blocked', 'blocks', 'blockedOf', 'blocksOf']) {
        assert.equal(actor.get(`${BLOCKED_CONTEXT}#${property}`).first.id, `${ACTOR_ID}/${property}`)
      }
    })
  })

  describe(EF61_CONTEXT, () => {
    it('imports ordered gateway URI literals and digestMultibase offline', async () => {
      const gateways = ['https://gateway-two.test', 'https://gateway-one.test']
      const actor = await as2.import({
        '@context': [AS_CONTEXT, EF61_CONTEXT],
        id: ACTOR_ID,
        type: 'Person',
        gateways,
        digestMultibase: 'zExampleDigest'
      })

      assert.deepEqual(Array.from(actor.get(`${EF61_CONTEXT}/gateways`)), gateways)
      assert.equal(actor.get('https://www.w3.org/ns/credentials/v2#digestMultibase').first,
        'zExampleDigest')
    })
  })
})
