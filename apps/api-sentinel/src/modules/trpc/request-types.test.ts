import { IndexMap, Mapping } from '@hoseki/packages/collection'
import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { Some } from '@hoseki/packages/result'
import { Decimal } from 'decimal.js'
import superjson from 'superjson'
import { describe, expect, it } from 'vitest'
import { checkRequestTypes } from './request-types'

const serializer = registerCustomSerializers(superjson)

describe('checkRequestTypes', () => {
  it('accepts the types Control Center sends', () => {
    const shared = new Date('2026-01-01T00:00:00Z')
    const { meta } = serializer.serialize({
      openingDate: shared,
      closingDate: shared,
      range: { from: new Date(0), to: undefined },
      amount: new Decimal('-1.5e+21'),
      sats: 21_000_000n,
      ratio: Number.NaN,
      rows: [{ when: new Date(1), fee: new Decimal(0) }],
    })

    expect(meta?.referentialEqualities).toBeDefined()
    expect(checkRequestTypes(meta).isOk()).toBe(true)
    expect(checkRequestTypes(undefined).isOk()).toBe(true)
  })

  it.each([
    ['set', new Set([1])],
    ['map', new Map([[1, 2]])],
    ['typed-array', new Uint8Array([1])],
    ['regexp', /x/],
    ['URL', new URL('https://example.com')],
    ['Error', new Error('x')],
    ['custom', Some(1)],
    ['custom', new Mapping([{ key: 'a' }])],
    ['custom', new IndexMap<{ id: string }, number>()],
  ])('refuses a %s', (type, value) => {
    const { meta } = serializer.serialize({ value })
    expect(checkRequestTypes(meta).unwrapErr()).toBe(`request type "${type}" isn't accepted`)
  })

  it('refuses an annotation path over 64 segments', () => {
    const deep = Array.from({ length: 65 }, () => 'a').join('.')
    expect(checkRequestTypes({ values: { [deep]: ['undefined'] } }).unwrapErr()).toBe('request path is too deep')
    expect(checkRequestTypes({ values: { [deep.slice(2)]: ['undefined'] } }).isOk()).toBe(true)
  })

  it('counts path segments through nested annotations', () => {
    type Annotation = [string] | [string, { a: Annotation }]
    let values: Annotation = ['undefined']
    for (let depth = 0; depth < 65; depth++) {
      values = ['undefined', { a: values }]
    }
    expect(checkRequestTypes({ values: { a: values } }).unwrapErr()).toBe('request path is too deep')
  })

  it('refuses a reference path over 64 segments', () => {
    const deep = Array.from({ length: 65 }, () => 'a').join('.')
    expect(checkRequestTypes({ referentialEqualities: { a: [deep] } }).unwrapErr()).toBe('request path is too deep')
    expect(checkRequestTypes({ referentialEqualities: [[deep]] }).unwrapErr()).toBe('request path is too deep')
  })

  it.each([
    { values: 5 },
    { values: ['undefined', 5] },
    { values: [['custom', 7]] },
    { referentialEqualities: 'a' },
    { referentialEqualities: { a: 'b' } },
    { referentialEqualities: { a: [5] } },
    'meta',
  ])('refuses malformed metadata %j without throwing', (meta) => {
    expect(checkRequestTypes(meta).isErr()).toBe(true)
  })
})
