import { expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { type Result, parseUnknown } from '../../result/index.ts'
import { SafeBody } from './body.ts'
import { type SafeBodyError, SafeBodyErrorKind } from './errors.ts'

const schema = z.object({
  id: z.number(),
})

it('returns parsed json', async () => {
  const json = { id: 0 }
  const body = new SafeBody({
    json: () => Promise.resolve(json),
  } as unknown as Body)
  const result = await body.json((responseJson) => parseUnknown(schema, responseJson))
  expectTypeOf<Result<{ id: number }, SafeBodyError>>(result)
  expect(result.unwrap()).toEqual(json)
})

it('returns error if body is unreadable', async () => {
  const body = new SafeBody({
    json: () => Promise.reject(new Error('Failed to read JSON body')),
  } as unknown as Body)
  const result = await body.json((json) => parseUnknown(schema, json))
  expect(result.expectErr('error missing').kind).toEqual(SafeBodyErrorKind.Unreadable)
})

it('returns error if body is malformed', async () => {
  const body = new SafeBody({
    json: () => Promise.resolve({ notInSchema: 'not a number' }),
  } as unknown as Body)
  const result = await body.json((json) => parseUnknown(schema, json))
  expect(result.expectErr('error missing').kind).toEqual(SafeBodyErrorKind.Malformed)
})
