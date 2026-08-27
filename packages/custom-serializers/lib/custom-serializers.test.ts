import { Err, None, Ok, Some } from '@patina/core'
import Decimal from 'decimal.js'
import SuperJSON from 'superjson'
import { expect, test } from 'vitest'
import { Mapping } from '../../collection'
import { registerCustomSerializers } from './custom-serializers'

registerCustomSerializers(SuperJSON)

test('Decimal', () => {
  const value = new Decimal('1.23')
  const serialized = SuperJSON.stringify(value)
  const deserialized = SuperJSON.parse(serialized)
  expect(deserialized).toEqual(value)
})

test('Mapping', () => {
  const value = new Mapping([
    { key: 'value', number: new Decimal(2) },
    { key: 'value2', number: new Decimal(3) },
  ])
  const serialized = SuperJSON.stringify(value)
  const deserialized = SuperJSON.parse(serialized)
  expect(deserialized).toEqual(value)
})

test('Option', () => {
  const some = Some(new Mapping([{ key: 'value', number: new Decimal(2) }]))
  let serialized = SuperJSON.stringify(some)
  let deserialized = SuperJSON.parse(serialized)
  expect(deserialized).toEqual(some)

  const none = None
  serialized = SuperJSON.stringify(none)
  deserialized = SuperJSON.parse(serialized)
  expect(deserialized).toEqual(none)
})

test('Result', () => {
  const ok = Ok(new Mapping([{ key: 'value', number: new Decimal(2) }]))
  let serialized = SuperJSON.stringify(ok)
  let deserialized = SuperJSON.parse(serialized)
  expect(deserialized).toEqual(ok)

  // SuperJSON reconstructs Error properties, which can differ in ownership from
  // the original Error across runtimes and test-runner versions. Assert the
  // Result and Error contract rather than object-property identity.
  const err = Err(new Error('error'))
  serialized = SuperJSON.stringify(err)
  deserialized = SuperJSON.parse(serialized)
  expect(deserialized.isErr()).toBe(true)
  expect(deserialized.error()).toBeInstanceOf(Error)
  expect(deserialized.error()).toMatchObject({ name: 'Error', message: 'error' })
})
