# Bundled JSON-LD contexts

`contexts.json` contains offline context documents and their URL aliases.
`activitystreams.js` registers these with activitystrea.ms at module load.
Registration enables JSON-LD parsing; it does not implement the protocols
described by these contexts.

The FEP and socialweb documents were copied from the local source repositories
on 2026-10-20:

- [FEP](https://codeberg.org/fediverse/fep), local revision
  `250c7862595080fc8ba73ca77d03044644eae963`.
- [socialweb](https://github.com/evanp/socialweb), local revision
  `36fd172facf813083829be91b50d0ca0fce44ac0`.
- [W3C Controlled Identifiers context](https://www.w3.org/ns/cid/v1).

The security, identity, data integrity, DID, multikey, GoToSocial, and miscellany
contexts were moved unchanged from the previous inline registrations in
`activitystreams.js`. The identity snapshot was originally bundled to avoid
an unavailable redirect target.

Only the document's `@context` is copied; ontology descriptions and example
documents are not registered as contexts.
FEPs without a context document have no registration.

FEP entries include the namespace URL, its trailing-slash form, and its
`.jsonld` form. FEP-2e40 uses its documented `https://w3id.org/fep` URL and
the original namespace document URL. The alternate FEP-888d context has its
own document URL rather than overriding the primary context.

Socialweb entries include the published version URLs and GitHub Pages document
URLs. Minor-version aliases select the latest patch in that minor version.
Unversioned aliases follow the repository's symlinks. In particular,
`socialweb/blocks` aliases blocked 2.0.0, while `socialweb/blocks/1.0.0`
retains its separate namespace. The unversioned seekitem URL uses 1.0.0.

Two source details are preserved explicitly:

- FEP-d8c8's missing quote and trailing comma are repaired in the bundled
  document. Its terms and identifiers are unchanged.
- Thread 1.0.0 places its definitions outside `@context`. That exact version
  therefore supplies only the Activity Streams context. Thread 1.0.1 and
  the unversioned and 1.0 aliases supply the corrected definitions.

The offline tests use independent fixtures in
`tests/fixtures/activitystreams-contexts.json`. Those fixtures record RDF
expansions generated directly from the source documents or original inline
definitions, including reference coercion, literal datatypes, scoped contexts,
and ordered lists. They do not
read the production context catalog or require the source repositories at
test time.
