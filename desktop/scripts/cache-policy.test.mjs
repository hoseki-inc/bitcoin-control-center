import CachePolicy from 'http-cache-semantics'
import { expect, test } from 'vitest'

test.each(['*', '* ', ' *', ' * ', '*,', '*, accept-language', 'accept-language, *'])(
  'does not reuse a cached download with Vary: %s',
  (vary) => {
    const request = { headers: { 'accept-language': 'en' } }
    const response = { headers: { 'cache-control': 'max-age=60', vary } }
    const policy = new CachePolicy(request, response)

    expect(policy.satisfiesWithoutRevalidation(request)).toBe(false)
  },
)

test('compares only request headers owned by each header map', () => {
  const inheritedHeaders = {}
  Object.setPrototypeOf(inheritedHeaders, { constructor: 'cached-user' })
  const policy = new CachePolicy(
    { headers: { constructor: 'cached-user' } },
    { headers: { 'cache-control': 'max-age=60', vary: 'constructor' } },
  )

  expect(policy.satisfiesWithoutRevalidation({ headers: inheritedHeaders })).toBe(false)
})

test('preserves cache hits for matching ordinary Vary headers', () => {
  const policy = new CachePolicy(
    { headers: { 'accept-language': 'en' } },
    { headers: { 'cache-control': 'max-age=60', vary: 'accept-language' } },
  )

  expect(policy.satisfiesWithoutRevalidation({ headers: { 'accept-language': 'en' } })).toBe(true)
  expect(policy.satisfiesWithoutRevalidation({ headers: { 'accept-language': 'fr' } })).toBe(false)
})

test('does not store a private response in a shared cache', () => {
  const request = { headers: { 'cache-control': 'max-stale=999999' } }
  const policy = new CachePolicy(request, {
    headers: { 'cache-control': 'private, max-age=0', 'set-cookie': 'session=fixture' },
  })

  expect(policy.storable()).toBe(false)
})
