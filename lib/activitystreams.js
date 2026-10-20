import as2 from 'activitystrea.ms'
import { createRequire } from 'node:module'

const contexts = createRequire(import.meta.url)('./contexts/contexts.json')

for (const { urls, document } of contexts) {
  for (const url of urls) {
    as2.registerContext(url, document)
  }
}

export default as2
