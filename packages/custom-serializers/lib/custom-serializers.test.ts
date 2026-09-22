import { Err, None, Ok, Some } from '@patina/core'
import Decimal from 'decimal.js'
import SuperJSON from 'superjson'
import { expect, test } from 'vitest'
import { IndexMap, IndexSet, Mapping } from '../../collection'
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
  const deserialized = SuperJSON.parse(serialized)
  expect(deserialized).toEqual(ok)

  // SuperJSON reconstructs Error properties, which can differ in ownership from
  // the original Error across runtimes and test-runner versions. Assert the
  // Result and Error contract rather than object-property identity.
  const err = Err(new Error('error'))
  serialized = SuperJSON.stringify(err)
  const deserializedError = SuperJSON.parse<typeof err>(serialized)
  expect(deserializedError.isErr()).toBe(true)
  expect(deserializedError.error()).toBeInstanceOf(Error)
  expect(deserializedError.error()).toMatchObject({ name: 'Error', message: 'error' })
})

test('IndexMap preserves object identifiers and bigint values after serialization', () => {
  const value = new IndexMap<{ id: string }, bigint>([
    [{ id: 'first' }, 1n],
    [{ id: 'second' }, 2n],
  ])
  const restored = SuperJSON.parse<IndexMap<{ id: string }, bigint>>(SuperJSON.stringify(value))
  expect(restored).toBeInstanceOf(IndexMap)
  expect(restored.size).toBe(2)
  expect(restored.get({ id: 'first' })).toBe(1n)
  expect(restored.get({ id: 'second' })).toBe(2n)
})

test('IndexSet preserves object keys after serialization', () => {
  const value = new IndexSet([{ key: 'first' }, { key: 'second' }])
  const restored = SuperJSON.parse<IndexSet<{ key: string }>>(SuperJSON.stringify(value))
  expect(restored).toBeInstanceOf(IndexSet)
  expect(restored.size).toBe(2)
  expect(restored.has({ key: 'first' })).toBe(true)
  expect(restored.has({ key: 'second' })).toBe(true)
})
