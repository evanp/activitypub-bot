import assert from 'node:assert'

export async function filterAsync (array, asyncPredicate) {
  assert.ok(array)
  assert.ok(Array.isArray(array))
  // 1. Kick off all predicate calls in parallel:
  const checks = array.map(item => asyncPredicate(item))

  // 2. Wait for all to settle into [true, false, …]:
  const booleans = await Promise.all(checks)

  // 3. Pick only those whose boolean was true:
  return array.filter((_, idx) => booleans[idx])
}
