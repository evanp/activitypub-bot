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
    id: '@id',
    type: '@type',

    dc: 'http://purl.org/dc/terms/',
    sec: 'https://w3id.org/security#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',

    EcdsaKoblitzSignature2016: 'sec:EcdsaKoblitzSignature2016',
    Ed25519Signature2018: 'sec:Ed25519Signature2018',
    EncryptedMessage: 'sec:EncryptedMessage',
    GraphSignature2012: 'sec:GraphSignature2012',
    LinkedDataSignature2015: 'sec:LinkedDataSignature2015',
    LinkedDataSignature2016: 'sec:LinkedDataSignature2016',
    CryptographicKey: 'sec:Key',

    authenticationTag: 'sec:authenticationTag',
    canonicalizationAlgorithm: 'sec:canonicalizationAlgorithm',
    cipherAlgorithm: 'sec:cipherAlgorithm',
    cipherData: 'sec:cipherData',
    cipherKey: 'sec:cipherKey',
    created: { '@id': 'dc:created', '@type': 'xsd:dateTime' },
    creator: { '@id': 'dc:creator', '@type': '@id' },
    digestAlgorithm: 'sec:digestAlgorithm',
    digestValue: 'sec:digestValue',
    domain: 'sec:domain',
    encryptionKey: 'sec:encryptionKey',
    expiration: { '@id': 'sec:expiration', '@type': 'xsd:dateTime' },
    expires: { '@id': 'sec:expiration', '@type': 'xsd:dateTime' },
    initializationVector: 'sec:initializationVector',
    iterationCount: 'sec:iterationCount',
    nonce: 'sec:nonce',
    normalizationAlgorithm: 'sec:normalizationAlgorithm',
    owner: { '@id': 'sec:owner', '@type': '@id' },
    password: 'sec:password',
    privateKey: { '@id': 'sec:privateKey', '@type': '@id' },
    privateKeyPem: 'sec:privateKeyPem',
    publicKey: { '@id': 'sec:publicKey', '@type': '@id' },
    publicKeyBase58: 'sec:publicKeyBase58',
    publicKeyPem: 'sec:publicKeyPem',
    publicKeyWif: 'sec:publicKeyWif',
    publicKeyService: { '@id': 'sec:publicKeyService', '@type': '@id' },
    revoked: { '@id': 'sec:revoked', '@type': 'xsd:dateTime' },
    salt: 'sec:salt',
    signature: 'sec:signature',
    signatureAlgorithm: 'sec:signingAlgorithm',
    signatureValue: 'sec:signatureValue'
  }
})

// This URL redirects to a dead domain (web-payments.org).
as2.registerContext('https://w3id.org/identity/v1', {
  '@context': {
    id: '@id',
    type: '@type',

    cred: 'https://w3id.org/credentials#',
    dc: 'http://purl.org/dc/terms/',
    identity: 'https://w3id.org/identity#',
    perm: 'https://w3id.org/permissions#',
    ps: 'https://w3id.org/payswarm#',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    sec: 'https://w3id.org/security#',
    schema: 'http://schema.org/',
    xsd: 'http://www.w3.org/2001/XMLSchema#',

    Group: 'https://www.w3.org/ns/activitystreams#Group',

    claim: { '@id': 'cred:claim', '@type': '@id' },
    credential: { '@id': 'cred:credential', '@type': '@id' },
    issued: { '@id': 'cred:issued', '@type': 'xsd:dateTime' },
    issuer: { '@id': 'cred:issuer', '@type': '@id' },
    recipient: { '@id': 'cred:recipient', '@type': '@id' },
    Credential: 'cred:Credential',
    CryptographicKeyCredential: 'cred:CryptographicKeyCredential',

    about: { '@id': 'schema:about', '@type': '@id' },
    address: { '@id': 'schema:address', '@type': '@id' },
    addressCountry: 'schema:addressCountry',
    addressLocality: 'schema:addressLocality',
    addressRegion: 'schema:addressRegion',
    comment: 'rdfs:comment',
    created: { '@id': 'dc:created', '@type': 'xsd:dateTime' },
    creator: { '@id': 'dc:creator', '@type': '@id' },
    description: 'schema:description',
    email: 'schema:email',
    familyName: 'schema:familyName',
    givenName: 'schema:givenName',
    image: { '@id': 'schema:image', '@type': '@id' },
    label: 'rdfs:label',
    name: 'schema:name',
    postalCode: 'schema:postalCode',
    streetAddress: 'schema:streetAddress',
    title: 'dc:title',
    url: { '@id': 'schema:url', '@type': '@id' },
    Person: 'schema:Person',
    PostalAddress: 'schema:PostalAddress',
    Organization: 'schema:Organization',

    identityService: { '@id': 'identity:identityService', '@type': '@id' },
    idp: { '@id': 'identity:idp', '@type': '@id' },
    Identity: 'identity:Identity',

    paymentProcessor: 'ps:processor',
    preferences: { '@id': 'ps:preferences', '@type': '@vocab' },

    cipherAlgorithm: 'sec:cipherAlgorithm',
    cipherData: 'sec:cipherData',
    cipherKey: 'sec:cipherKey',
    digestAlgorithm: 'sec:digestAlgorithm',
    digestValue: 'sec:digestValue',
    domain: 'sec:domain',
    expires: { '@id': 'sec:expiration', '@type': 'xsd:dateTime' },
    initializationVector: 'sec:initializationVector',
    member: { '@id': 'schema:member', '@type': '@id' },
    memberOf: { '@id': 'schema:memberOf', '@type': '@id' },
    nonce: 'sec:nonce',
    normalizationAlgorithm: 'sec:normalizationAlgorithm',
    owner: { '@id': 'sec:owner', '@type': '@id' },
    password: 'sec:password',
    privateKey: { '@id': 'sec:privateKey', '@type': '@id' },
    privateKeyPem: 'sec:privateKeyPem',
    publicKey: { '@id': 'sec:publicKey', '@type': '@id' },
    publicKeyPem: 'sec:publicKeyPem',
    publicKeyService: { '@id': 'sec:publicKeyService', '@type': '@id' },
    revoked: { '@id': 'sec:revoked', '@type': 'xsd:dateTime' },
    signature: 'sec:signature',
    signatureAlgorithm: 'sec:signingAlgorithm',
    signatureValue: 'sec:signatureValue',
    CryptographicKey: 'sec:Key',
    EncryptedMessage: 'sec:EncryptedMessage',
    GraphSignature2012: 'sec:GraphSignature2012',
    LinkedDataSignature2015: 'sec:LinkedDataSignature2015',

    accessControl: { '@id': 'perm:accessControl', '@type': '@id' },
    writePermission: { '@id': 'perm:writePermission', '@type': '@id' }
  }
})

as2.registerContext('https://w3id.org/security/data-integrity/v1', {
  '@context': {
    id: '@id',
    type: '@type',
    '@protected': true,
    proof: {
      '@id': 'https://w3id.org/security#proof',
      '@type': '@id',
      '@container': '@graph'
    },
    DataIntegrityProof: {
      '@id': 'https://w3id.org/security#DataIntegrityProof',
      '@context': {
        '@protected': true,
        id: '@id',
        type: '@type',
        challenge: 'https://w3id.org/security#challenge',
        created: {
          '@id': 'http://purl.org/dc/terms/created',
          '@type': 'http://www.w3.org/2001/XMLSchema#dateTime'
        },
        domain: 'https://w3id.org/security#domain',
        expires: {
          '@id': 'https://w3id.org/security#expiration',
          '@type': 'http://www.w3.org/2001/XMLSchema#dateTime'
        },
        nonce: 'https://w3id.org/security#nonce',
        proofPurpose: {
          '@id': 'https://w3id.org/security#proofPurpose',
          '@type': '@vocab',
          '@context': {
            '@protected': true,
            id: '@id',
            type: '@type',
            assertionMethod: {
              '@id': 'https://w3id.org/security#assertionMethod',
              '@type': '@id',
              '@container': '@set'
            },
            authentication: {
              '@id': 'https://w3id.org/security#authenticationMethod',
              '@type': '@id',
              '@container': '@set'
            },
            capabilityInvocation: {
              '@id': 'https://w3id.org/security#capabilityInvocationMethod',
              '@type': '@id',
              '@container': '@set'
            },
            capabilityDelegation: {
              '@id': 'https://w3id.org/security#capabilityDelegationMethod',
              '@type': '@id',
              '@container': '@set'
            },
            keyAgreement: {
              '@id': 'https://w3id.org/security#keyAgreementMethod',
              '@type': '@id',
              '@container': '@set'
            }
          }
        },
        cryptosuite: 'https://w3id.org/security#cryptosuite',
        proofValue: {
          '@id': 'https://w3id.org/security#proofValue',
          '@type': 'https://w3id.org/security#multibase'
        },
        verificationMethod: {
          '@id': 'https://w3id.org/security#verificationMethod',
          '@type': '@id'
        }
      }
    }
  }
})

as2.registerContext('https://www.w3.org/ns/did/v1', {
  '@context': {
    '@protected': true,
    id: '@id',
    type: '@type',
    alsoKnownAs: {
      '@id': 'https://www.w3.org/ns/activitystreams#alsoKnownAs',
      '@type': '@id'
    },
    assertionMethod: {
      '@id': 'https://w3id.org/security#assertionMethod',
      '@type': '@id',
      '@container': '@set'
    },
    authentication: {
      '@id': 'https://w3id.org/security#authenticationMethod',
      '@type': '@id',
      '@container': '@set'
    },
    capabilityDelegation: {
      '@id': 'https://w3id.org/security#capabilityDelegationMethod',
      '@type': '@id',
      '@container': '@set'
    },
    capabilityInvocation: {
      '@id': 'https://w3id.org/security#capabilityInvocationMethod',
      '@type': '@id',
      '@container': '@set'
    },
    controller: {
      '@id': 'https://w3id.org/security#controller',
      '@type': '@id'
    },
    keyAgreement: {
      '@id': 'https://w3id.org/security#keyAgreementMethod',
      '@type': '@id',
      '@container': '@set'
    },
    service: {
      '@id': 'https://www.w3.org/ns/did#service',
      '@type': '@id',
      '@context': {
        '@protected': true,
        id: '@id',
        type: '@type',
        serviceEndpoint: {
          '@id': 'https://www.w3.org/ns/did#serviceEndpoint',
          '@type': '@id'
        }
      }
    },
    verificationMethod: {
      '@id': 'https://w3id.org/security#verificationMethod',
      '@type': '@id'
    }
  }
})

as2.registerContext('https://w3id.org/security/multikey/v1', {
  '@context': {
    id: '@id',
    type: '@type',
    '@protected': true,
    Multikey: {
      '@id': 'https://w3id.org/security#Multikey',
      '@context': {
        '@protected': true,
        id: '@id',
        type: '@type',
        controller: {
          '@id': 'https://w3id.org/security#controller',
          '@type': '@id'
        },
        revoked: {
          '@id': 'https://w3id.org/security#revoked',
          '@type': 'http://www.w3.org/2001/XMLSchema#dateTime'
        },
        expires: {
          '@id': 'https://w3id.org/security#expiration',
          '@type': 'http://www.w3.org/2001/XMLSchema#dateTime'
        },
        publicKeyMultibase: {
          '@id': 'https://w3id.org/security#publicKeyMultibase',
          '@type': 'https://w3id.org/security#multibase'
        },
        secretKeyMultibase: {
          '@id': 'https://w3id.org/security#secretKeyMultibase',
          '@type': 'https://w3id.org/security#multibase'
        }
      }
    }
  }
})

as2.registerContext('https://gotosocial.org/ns', {
  '@context': {
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    gts: 'https://gotosocial.org/ns#',
    LikeRequest: 'gts:LikeRequest',
    ReplyRequest: 'gts:ReplyRequest',
    AnnounceRequest: 'gts:AnnounceRequest',
    QuoteRequest: 'gts:QuoteRequest',
    LikeAuthorization: 'gts:LikeApproval',
    ReplyAuthorization: 'gts:ReplyAuthorization',
    AnnounceAuthorization: 'gts:AnnounceAuthorization',
    QuoteAuthorization: 'gts:QuoteAuthorization',
    likeAuthorization: { '@id': 'gts:likeAuthorization', '@type': '@id' },
    replyAuthorization: { '@id': 'gts:replyAuthorization', '@type': '@id' },
    announceAuthorization: { '@id': 'gts:announceAuthorization', '@type': '@id' },
    quoteAuthorization: { '@id': 'gts:quoteAuthorization', '@type': '@id' },
    interactingObject: { '@id': 'gts:interactingObject', '@type': '@id' },
    interactionTarget: { '@id': 'gts:interactionTarget', '@type': '@id' },
    interactionPolicy: { '@id': 'gts:interactionPolicy', '@type': '@id' },
    canLike: { '@id': 'gts:canLike', '@type': '@id' },
    canReply: { '@id': 'gts:canReply', '@type': '@id' },
    canAnnounce: { '@id': 'gts:canAnnounce', '@type': '@id' },
    canQuote: { '@id': 'gts:canQuote', '@type': '@id' },
    automaticApproval: { '@id': 'gts:automaticApproval', '@type': '@id' },
    manualApproval: { '@id': 'gts:manualApproval', '@type': '@id' },
    hidesToPublicFromUnauthedWeb: { '@id': 'gts:hidesToPublicFromUnauthedWeb', '@type': 'xsd:boolean' },
    hidesCcPublicFromUnauthedWeb: { '@id': 'gts:hidesCcPublicFromUnauthedWeb', '@type': 'xsd:boolean' },
    always: { '@id': 'gts:always', '@type': '@id' },
    approvalRequired: { '@id': 'gts:approvalRequired', '@type': '@id' },
    approvedBy: { '@id': 'gts:approvedBy', '@type': '@id' }
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

as2.registerContext('https://purl.archive.org/socialweb/webfinger', {
  '@context': {
    wf: 'https://purl.archive.org/socialweb/webfinger#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    webfinger: {
      '@id': 'wf:webfinger',
      '@type': 'xsd:string'
    }
  }
})

export default as2
