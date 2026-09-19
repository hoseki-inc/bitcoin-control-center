import { expect, test } from 'vitest'
import { type Mappable, Mapping } from './mapping'

let c = 0

function value(): { key: () => string } {
  const k = c
  c += 1
  return {
    key() {
      return `key_${k}`
    },
  }
}

test('constructor', () => {
  const map = new Mapping([value(), value(), value()])
  expect(map.size()).toBe(3)
})

test('clear', () => {
  const map = new Mapping([value(), value(), value()])
  map.clear()
  expect(map.size()).toBe(0)
})

test('delete', () => {
  const toDelete = value()
  const map = new Mapping([value(), toDelete, value()])
  map.delete(toDelete.key())
  expect(map.size()).toBe(2)
  expect(map.has(toDelete.key())).toBe(false)
})

test('get', () => {
  const toGet = value()
  const map = new Mapping([value(), toGet, value()])
  expect(map.get(toGet.key()).expect('should find value')).toBe(toGet)
})

test('has', () => {
  const toHas = value()
  const map = new Mapping([value(), toHas, value()])
  expect(map.has(toHas.key())).toBe(true)
})

test('set', () => {
  const toSet = value()
  const map = new Mapping([value(), value(), value()])
  map.set(toSet)
  expect(map.size()).toBe(4)
  expect(map.get(toSet.key()).unwrap()).toBe(toSet)
})

test('keys', () => {
  const values = [value(), value(), value()]
  const map = new Mapping(values)
  expect(Array.from(map.keys())).toEqual(values.map((v) => v.key()))
})

test('values', () => {
  const values = [value(), value(), value()]
  const map = new Mapping(values)
  expect(Array.from(map.values())).toEqual(values)
})

test('entries', () => {
  const values = [value(), value(), value()]
  const map = new Mapping(values)
  expect(Array.from(map.entries())).toEqual(values.map((v) => [v.key(), v]))
})

test('iterator', () => {
  const values = [value(), value(), value()]
  const map = new Mapping(values)
  expect(Array.from(map)).toEqual(values.map((v) => [v.key(), v]))
})

test('forEach', () => {
  const values = [value(), value(), value()]
  const map = new Mapping(values)
  const entries: [string, Mappable][] = []
  map.forEach((entryValue, key) => {
    entries.push([key, entryValue])
  })
  expect(entries).toEqual(values.map((v) => [v.key(), v]))
})

test('toString shows stored keys without coercing values or reevaluating keys', () => {
  let keyCalls = 0
  const first = {
    key(): string {
      keyCalls += 1
      return 'first'
    },
    amount: 1n,
    toString(): string {
      throw new Error('must not stringify a mapped value')
    },
  }
  const map = new Mapping<Mappable>([first, { key: 'second' }])
  expect(map.toString()).toBe('Mapping(first, second)')
  expect(keyCalls).toBe(1)
  expect(map.get('first').unwrap()).toBe(first)
})

test('toString handles an empty Mapping', () => {
  expect(new Mapping().toString()).toBe('Mapping()')
})
