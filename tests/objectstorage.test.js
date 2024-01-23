import { describe, it, before } from 'node:test'
import as2 from 'activitystrea.ms'
import assert from 'node:assert'
import { ObjectStorage, NoSuchObjectError } from '../lib/objectstorage.js'
import { promisify } from 'node:util'

const as2import = promisify(as2.import)

describe('ObjectStorage', async () => {
  let doc = null
  before(async () => {
    doc = await as2import({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://social.example/users/test/note/1',
      type: 'Note',
      name: 'test',
      content: 'test'
    })
  })
  it('can initialize', async () => {
    await ObjectStorage.initialize('sqlite::memory:')
  })
  it('can create a new object', async () => {
    await ObjectStorage.create(doc)
  })
  it('can read a created object', async () => {
    const read = await ObjectStorage.read(doc.id)
  })
  it('can update a created object', async () => {
    const doc2 = await as2import({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://social.example/users/test/note/1',
      type: 'Note',
      name: 'test2',
      content: 'test2'
    })
    await ObjectStorage.update(doc2)
    const read = await ObjectStorage.read(doc2.id)
    assert.equal(read.name.get('en'), 'test2')
  })
  it('can delete a created object', async () => {
    await ObjectStorage.delete(doc)
    try {
      const read = await ObjectStorage.read(doc.id)
      assert.fail('should not be able to read deleted object')
    } catch (err) {
      assert.ok(err instanceof NoSuchObjectError)
    }
  })
  it('can terminate', async () => {
    await ObjectStorage.terminate()
  })
})