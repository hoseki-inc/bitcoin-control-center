import { describe, expect, test } from 'vitest'
import { IndexMap } from './index_map'

describe('constructor', () => {
  test('should initialize with size 0', () => {
    const map = new IndexMap<string, number>()
    expect(map.size).toBe(0)
  })
})

describe('set and get', () => {
  test('should set and get a string key', () => {
    const map = new IndexMap<string, number>()
    map.set('one', 1)
    expect(map.get('one')).toBe(1)
    expect(map.size).toBe(1)
  })

  test('should set and get an object with a key', () => {
    const map = new IndexMap<{ key: string }, number>()
    map.set({ key: 'b' }, 2)
    expect(map.get({ key: 'b' })).toBe(2)
  })

  test('should set and get an object with an ID', () => {
    const map = new IndexMap<{ id: string }, number>()
    map.set({ id: 'a' }, 1)
    expect(map.get({ id: 'a' })).toBe(1)
  })

  test('should set and get an object with toString', () => {
    const obj = {
      toString: () => 'b',
    }
    const map = new IndexMap<typeof obj, number>()
    map.set(obj, 2)
    expect(map.get(obj)).toBe(2)
  })
})

describe('delete', () => {
  test('should delete a string key', () => {
    const map = new IndexMap<string, number>()
    map.set('one', 1)
    expect(map.delete('one')).toBe(true)
    expect(map.size).toBe(0)
    expect(map.delete('nonexistent')).toBe(false)
  })

  test('should delete an object with a key', () => {
    const map = new IndexMap<{ key: string }, number>()
    map.set({ key: 'a' }, 1)
    expect(map.delete({ key: 'a' })).toBe(true)
    expect(map.size).toBe(0)
  })

  test('should delete an object with an ID', () => {
    const map = new IndexMap<{ id: string }, number>()
    map.set({ id: 'a' }, 1)
    expect(map.delete({ id: 'a' })).toBe(true)
    expect(map.size).toBe(0)
  })

  test('should delete an object with toString', () => {
    const obj = {
      toString: () => 'a',
    }
    const map = new IndexMap<typeof obj, number>()
    map.set(obj, 1)
    expect(map.delete(obj)).toBe(true)
    expect(map.size).toBe(0)
  })
})

describe('clear', () => {
  test('should clear the map', () => {
    const map = new IndexMap<string, number>()
    map.set('one', 1)
    map.set('two', 2)
    map.clear()
    expect(map.size).toBe(0)
  })
})

describe('has', () => {
  test('should check existence of a string key', () => {
    const map = new IndexMap<string, number>()
    map.set('one', 1)
    expect(map.has('one')).toBe(true)
    expect(map.has('two')).toBe(false)
  })

  test('should check existence of an object with a key', () => {
    const map = new IndexMap<{ key: string }, number>()
    map.set({ key: 'a' }, 1)
    expect(map.has({ key: 'a' })).toBe(true)
    expect(map.has({ key: 'b' })).toBe(false)
  })

  test('should check existence of an object with an ID', () => {
    const map = new IndexMap<{ id: string }, number>()
    map.set({ id: 'a' }, 1)
    expect(map.has({ id: 'a' })).toBe(true)
    expect(map.has({ id: 'b' })).toBe(false)
  })

  test('should check existence of an object with toString', () => {
    const obj = {
      toString: () => 'a',
    }
    const map = new IndexMap<typeof obj, number>()
    map.set(obj, 1)
    expect(map.has(obj)).toBe(true)
    expect(map.has({ toString: () => 'b' })).toBe(false)
  })
})

describe('forEach', () => {
  test('should iterate over string keys', () => {
    const map = new IndexMap<string, number>()
    map.set('one', 1)
    map.set('two', 2)
    const result: [string, number][] = []
    map.forEach((value, key) => {
      result.push([key, value])
    })
    expect(result).toEqual([
      ['one', 1],
      ['two', 2],
    ])
  })

  test('should iterate over object keys with ID', () => {
    const map = new IndexMap<{ key: string }, number>()
    map.set({ key: 'a' }, 1)
    map.set({ key: 'b' }, 2)
    const result: [{ key: string }, number][] = []
    map.forEach((value, key) => {
      result.push([key, value])
    })
    expect(result).toEqual([
      [{ key: 'a' }, 1],
      [{ key: 'b' }, 2],
    ])
  })

  test('should iterate over object keys with ID', () => {
    const map = new IndexMap<{ id: string }, number>()
    map.set({ id: 'a' }, 1)
    map.set({ id: 'b' }, 2)
    const result: [{ id: string }, number][] = []
    map.forEach((value, key) => {
      result.push([key, value])
    })
    expect(result).toEqual([
      [{ id: 'a' }, 1],
      [{ id: 'b' }, 2],
    ])
  })
})

describe('entries', () => {
  test('should return entries for string keys', () => {
    const map = new IndexMap<string, number>()
    map.set('one', 1)
    map.set('two', 2)
    const entries = Array.from(map.entries())
    expect(entries).toEqual([
      ['one', 1],
      ['two', 2],
    ])
  })

  test('should return entries for object keys with key', () => {
    const map = new IndexMap<{ key: string }, number>()
    map.set({ key: 'a' }, 1)
    map.set({ key: 'b' }, 2)
    const entries = Array.from(map.entries())
    expect(entries).toEqual([
      [{ key: 'a' }, 1],
      [{ key: 'b' }, 2],
    ])
  })

  test('should return entries for object keys with ID', () => {
    const map = new IndexMap<{ id: string }, number>()
    map.set({ id: 'a' }, 1)
    map.set({ id: 'b' }, 2)
    const entries = Array.from(map.entries())
    expect(entries).toEqual([
      [{ id: 'a' }, 1],
      [{ id: 'b' }, 2],
    ])
  })
})

describe('keys', () => {
  test('should return keys for string keys', () => {
    const map = new IndexMap<string, number>()
    map.set('one', 1)
    map.set('two', 2)
    const keys = Array.from(map.keys())
    expect(keys).toEqual(['one', 'two'])
  })

  test('should return keys for object keys with key', () => {
    const map = new IndexMap<{ key: string }, number>()
    map.set({ key: 'a' }, 1)
    map.set({ key: 'b' }, 2)
    const keys = Array.from(map.keys())
    expect(keys).toEqual([{ key: 'a' }, { key: 'b' }])
  })

  test('should return keys for object keys with ID', () => {
    const map = new IndexMap<{ id: string }, number>()
    map.set({ id: 'a' }, 1)
    map.set({ id: 'b' }, 2)
    const keys = Array.from(map.keys())
    expect(keys).toEqual([{ id: 'a' }, { id: 'b' }])
  })
})

describe('values', () => {
  test('should return values for string keys', () => {
    const map = new IndexMap<string, number>()
    map.set('one', 1)
    map.set('two', 2)
    const values = Array.from(map.values())
    expect(values).toEqual([1, 2])
  })

  test('should return values for object keys with key', () => {
    const map = new IndexMap<{ key: string }, number>()
    map.set({ key: 'a' }, 1)
    map.set({ key: 'b' }, 2)
    const values = Array.from(map.values())
    expect(values).toEqual([1, 2])
  })

  test('should return values for object keys with ID', () => {
    const map = new IndexMap<{ id: string }, number>()
    map.set({ id: 'a' }, 1)
    map.set({ id: 'b' }, 2)
    const values = Array.from(map.values())
    expect(values).toEqual([1, 2])
  })
})

describe('Symbol.iterator', () => {
  test('should iterate over string keys', () => {
    const map = new IndexMap<string, number>()
    map.set('one', 1)
    map.set('two', 2)
    const entries = Array.from(map)
    expect(entries).toEqual([
      ['one', 1],
      ['two', 2],
    ])
  })

  test('should iterate over object keys with key', () => {
    const map = new IndexMap<{ key: string }, number>()
    map.set({ key: 'a' }, 1)
    map.set({ key: 'b' }, 2)
    const entries = Array.from(map)
    expect(entries).toEqual([
      [{ key: 'a' }, 1],
      [{ key: 'b' }, 2],
    ])
  })

  test('should iterate over object keys with ID', () => {
    const map = new IndexMap<{ id: string }, number>()
    map.set({ id: 'a' }, 1)
    map.set({ id: 'b' }, 2)
    const entries = Array.from(map)
    expect(entries).toEqual([
      [{ id: 'a' }, 1],
      [{ id: 'b' }, 2],
    ])
  })
})

describe('Symbol.toStringTag', () => {
  test('should return correct toStringTag', () => {
    const map = new IndexMap<string, number>()
    expect(Object.prototype.toString.call(map)).toBe('[object IndexMap]')
  })
})

describe('groupBy', () => {
  test('should group values by key', () => {
    const items = [
      { id: 1, category: 'fruits', name: 'apple' },
      { id: 2, category: 'fruits', name: 'banana' },
      { id: 3, category: 'vegetables', name: 'carrot' },
      { id: 4, category: 'fruits', name: 'date' },
    ]

    const grouped = IndexMap.groupBy(items, (item) => item.category)

    expect(grouped.get('fruits')).toEqual([
      { id: 1, category: 'fruits', name: 'apple' },
      { id: 2, category: 'fruits', name: 'banana' },
      { id: 4, category: 'fruits', name: 'date' },
    ])
    expect(grouped.get('vegetables')).toEqual([{ id: 3, category: 'vegetables', name: 'carrot' }])
    expect(grouped.get('grains')).toBeUndefined()
  })
})
