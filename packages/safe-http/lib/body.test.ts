import { expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import { type Result, parseUnknown } from '../../result/index.ts'
import { SafeBody } from './body.ts'
import { type SafeBodyError, SafeBodyErrorKind } from './errors.ts'

const schema = z.object({
  id: z.number(),
})

it('returns parsed json', async () => {
  const json = { id: 0 }
  const body = new SafeBody(Response.json(json))
  const result = await body.json((responseJson) => parseUnknown(schema, responseJson))
  expectTypeOf<Result<{ id: number }, SafeBodyError>>(result)
  expect(result.expect('Expected successful result')).toEqual(json)
})

it('returns error if body is unreadable', async () => {
  const response = new Response()
  vi.spyOn(response, 'json').mockRejectedValue(new Error('Failed to read JSON body'))
  const body = new SafeBody(response)
  const result = await body.json((json) => parseUnknown(schema, json))
  expect(result.expectErr('error missing').kind).toEqual(SafeBodyErrorKind.Unreadable)
})

it('returns error if body is malformed', async () => {
  const body = new SafeBody(Response.json({ notInSchema: 'not a number' }))
  const result = await body.json((json) => parseUnknown(schema, json))
  expect(result.expectErr('error missing').kind).toEqual(SafeBodyErrorKind.Malformed)
})
