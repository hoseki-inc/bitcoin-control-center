import { IndexMap, Mapping } from '@hoseki/packages/collection'
import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { Some } from '@hoseki/packages/result'
import { TRPCError } from '@trpc/server'
import { Decimal } from 'decimal.js'
import superjson, { type SuperJSONResult } from 'superjson'
import { assert, describe, expect, it } from 'vitest'
import { checkRequestTypes, requestTransformer } from './request-types'

const serializer = registerCustomSerializers(superjson)
const transformer = requestTransformer(serializer)
const path = (length: number): string => Array.from({ length }, () => 'a').join('.')

describe('checkRequestTypes', () => {
  it('accepts the types Control Center sends', () => {
    const shared = new Date('2026-01-01T00:00:00Z')
    const body = serializer.serialize({
      openingDate: shared,
      closingDate: shared,
      range: { from: new Date(0), to: undefined },
      amount: new Decimal('-1.5e+21'),
      sats: 21_000_000n,
      ratio: Number.NaN,
      rows: [{ when: new Date(1), fee: new Decimal(0) }],
    })

    expect(body.meta?.referentialEqualities).toBeDefined()
    expect(checkRequestTypes(body).isOk()).toBe(true)
    expect(checkRequestTypes({ json: 'plain' }).isOk()).toBe(true)
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
    expect(checkRequestTypes(serializer.serialize({ value })).unwrapErr()).toBe(`request type "${type}" isn't accepted`)
  })

  it.each([['custom:Decimal'], [['Date']], [['Date', null]], [['custom', 'Decimal', 'x']]])(
    'refuses the near-miss annotation %j',
    (annotation) => {
      expect(checkRequestTypes({ meta: { values: { a: [annotation] } } }).isErr()).toBe(true)
    },
  )

  it('caps an annotation path at 64 segments', () => {
    expect(checkRequestTypes({ meta: { values: { [path(64)]: ['undefined'] } } }).isOk()).toBe(true)
    expect(checkRequestTypes({ meta: { values: { [path(65)]: ['undefined'] } } }).unwrapErr()).toBe(
      'request path is too deep',
    )
  })

  it('counts path segments through nested annotations', () => {
    type Annotation = [string] | [string, { a: Annotation }]
    let values: Annotation = ['undefined']
    for (let depth = 0; depth < 65; depth++) {
      values = ['undefined', { a: values }]
    }
    expect(checkRequestTypes({ meta: { values: { a: values } } }).unwrapErr()).toBe('request path is too deep')
  })

  it('caps a reference path at 64 segments', () => {
    expect(checkRequestTypes({ meta: { referentialEqualities: { a: [path(64)] } } }).isOk()).toBe(true)
    expect(checkRequestTypes({ meta: { referentialEqualities: [[path(64)], { a: ['b'] }] } }).isOk()).toBe(true)
    expect(checkRequestTypes({ meta: { referentialEqualities: { a: [path(65)] } } }).unwrapErr()).toBe(
      'request path is too deep',
    )
    expect(checkRequestTypes({ meta: { referentialEqualities: [[path(65)]] } }).unwrapErr()).toBe(
      'request path is too deep',
    )
  })

  it.each([
    null,
    'body',
    { meta: 'meta' },
    { meta: { values: 5 } },
    { meta: { values: ['undefined', 5] } },
    { meta: { values: [['custom', 7]] } },
    { meta: { referentialEqualities: 'a' } },
    { meta: { referentialEqualities: { a: 'b' } } },
    { meta: { referentialEqualities: { a: [5] } } },
  ])('refuses malformed body %j without throwing', (body) => {
    expect(checkRequestTypes(body).isErr()).toBe(true)
  })
})

describe('requestTransformer', () => {
  function refusal(body: SuperJSONResult): TRPCError {
    try {
      transformer.deserialize(body)
    } catch (cause) {
      assert(cause instanceof TRPCError, 'expected a tRPC error')
      return cause
    }
    throw new Error('expected the body to be refused')
  }

  it('reads what superjson writes', () => {
    const value = { when: new Date(0), amount: new Decimal('2.5'), note: undefined }
    expect(transformer.deserialize(transformer.serialize(value))).toEqual(value)
  })

  it('answers 400 with the reason for a refused type', () => {
    expect(refusal(serializer.serialize({ value: new Set([1]) }))).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Invalid request body: request type "set" isn\'t accepted',
    })
  })

  it('answers 400 with the generic message when superjson fails', () => {
    const body = {
      json: { a: 'not decimal' },
      meta: { values: { a: [['custom', 'Decimal']] } },
    } satisfies SuperJSONResult
    expect(refusal(body)).toMatchObject({ code: 'BAD_REQUEST', message: 'Invalid request body' })
  })
})
