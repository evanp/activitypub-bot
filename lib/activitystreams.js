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

export default as2
