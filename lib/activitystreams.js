import as2 from 'activitystrea.ms'

as2.registerContext('https://w3id.org/fep/5711', {
  '@context': {
    inv: 'https://w3id.org/fep/5711#',
    likesOf: {
      '@id': 'inv:likesOf',
      '@type': '@id'
    },
    sharesOf: {
      '@id': 'inv:sharesOf',
      '@type': '@id'
    },
    repliesOf: {
      '@id': 'inv:repliesOf',
      '@type': '@id'
    },
    inboxOf: {
      '@id': 'inv:inboxOf',
      '@type': '@id'
    },
    outboxOf: {
      '@id': 'inv:outboxOf',
      '@type': '@id'
    },
    followersOf: {
      '@id': 'inv:followersOf',
      '@type': '@id'
    },
    followingOf: {
      '@id': 'inv:followingOf',
      '@type': '@id'
    },
    likedOf: {
      '@id': 'inv:likedOf',
      '@type': '@id'
    }
  }
})

as2.registerContext('https://w3id.org/security/v1', {
  '@context': {
    sec: 'https://w3id.org/security#',
    id: '@id',
    type: '@type',
    owner: {
      '@id': 'sec:owner',
      '@type': '@id'
    },
    publicKey: {
      '@id': 'sec:publicKey',
      '@type': '@id'
    },
    publicKeyPem: 'sec:publicKeyPem'
  }
})

as2.registerContext('https://purl.archive.org/socialweb/thread/1.0', {
  '@context': {
    thr: 'https://purl.archive.org/socialweb/thread#',
    thread: {
      '@id': 'thr:thread',
      '@type': '@id'
    },
    root: {
      '@id': 'thr:root',
      '@type': '@id'
    }
  }
})

export default as2
