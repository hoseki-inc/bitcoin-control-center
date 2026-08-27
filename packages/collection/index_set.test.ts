import { describe, expect, test } from 'vitest'
import { IndexSet } from './index_set'

describe('constructor', () => {
  test('should initialize with size 0', () => {
    const set = new IndexSet<string>()
    expect(set.size).toBe(0)
  })
})

describe('add and has', () => {
  test('should add and check existence of a string value', () => {
    const set = new IndexSet<string>()
    set.add('one')
    expect(set.has('one')).toBe(true)
    expect(set.size).toBe(1)
  })

  test('should add and check existence of an object value', () => {
    const set = new IndexSet<{ id: string }>()
    set.add({ id: 'a' })
    expect(set.has({ id: 'a' })).toBe(true)
  })
})

describe('delete', () => {
  test('should delete a string value', () => {
    const set = new IndexSet<string>()
    set.add('one')
    expect(set.delete('one')).toBe(true)
    expect(set.size).toBe(0)
    expect(set.delete('nonexistent')).toBe(false)
  })

  test('should delete an object value', () => {
    const set = new IndexSet<{ id: string }>()
    set.add({ id: 'a' })
    expect(set.delete({ id: 'a' })).toBe(true)
    expect(set.size).toBe(0)
  })
})

describe('clear', () => {
  test('should clear the set', () => {
    const set = new IndexSet<string>()
    set.add('one')
    set.add('two')
    set.clear()
    expect(set.size).toBe(0)
  })
})

describe('forEach', () => {
  test('should iterate over string values', () => {
    const set = new IndexSet<string>()
    set.add('one')
    set.add('two')
    const result: string[] = []
    set.forEach((value) => {
      result.push(value)
    })
    expect(result).toEqual(['one', 'two'])
  })

  test('should iterate over object values', () => {
    const set = new IndexSet<{ id: string }>()
    set.add({ id: 'a' })
    set.add({ id: 'b' })
    const result: { id: string }[] = []
    set.forEach((value) => {
      result.push(value)
    })
    expect(result).toEqual([{ id: 'a' }, { id: 'b' }])
  })
})

describe('values', () => {
  test('should return values for string values', () => {
    const set = new IndexSet<string>()
    set.add('one')
    set.add('two')
    const values = Array.from(set.values())
    expect(values).toEqual(['one', 'two'])
  })

  test('should return values for object values', () => {
    const set = new IndexSet<{ id: string }>()
    set.add({ id: 'a' })
    set.add({ id: 'b' })
    const values = Array.from(set.values())
    expect(values).toEqual([{ id: 'a' }, { id: 'b' }])
  })
})

describe('Symbol.iterator', () => {
  test('should iterate over string values', () => {
    const set = new IndexSet<string>()
    set.add('one')
    set.add('two')
    const values = Array.from(set)
    expect(values).toEqual(['one', 'two'])
  })

  test('should iterate over object values', () => {
    const set = new IndexSet<{ id: string }>()
    set.add({ id: 'a' })
    set.add({ id: 'b' })
    const values = Array.from(set)
    expect(values).toEqual([{ id: 'a' }, { id: 'b' }])
  })
})

describe('Symbol.toStringTag', () => {
  test('should return correct toStringTag', () => {
    const set = new IndexSet<string>()
    expect(Object.prototype.toString.call(set)).toBe('[object IndexSet]')
  })
})

describe('set composition', () => {
  test('should compute the union of two sets', () => {
    const setA = new IndexSet<number>([1, 2, 3])
    const setB = new IndexSet<number>([3, 4, 5])
    const unionSet = setA.union(setB)
    const values = Array.from(unionSet.values())
    expect(values).toEqual([1, 2, 3, 4, 5])
  })

  test('should compute the intersection of two sets', () => {
    const setA = new IndexSet<number>([1, 2, 3])
    const setB = new IndexSet<number>([2, 3, 4])
    const intersectionSet = setA.intersection(setB)
    const values = Array.from(intersectionSet.values())
    expect(values).toEqual([2, 3])
  })

  test('should compute the difference of two sets', () => {
    const setA = new IndexSet<number>([1, 2, 3])
    const setB = new IndexSet<number>([2, 3, 4])
    const differenceSet = setA.difference(setB)
    const values = Array.from(differenceSet.values())
    expect(values).toEqual([1])
  })

  test('should compute the symmetric difference of two sets', () => {
    const setA = new IndexSet<number>([1, 2, 3])
    const setB = new IndexSet<number>([3, 4, 5])
    const symmetricDifferenceSet = setA.symmetricDifference(setB)
    const values = Array.from(symmetricDifferenceSet.values())
    expect(values).toEqual([1, 2, 4, 5])
  })

  test('should check if a set is a subset of another', () => {
    const setA = new IndexSet<number>([1, 2])
    const setB = new IndexSet<number>([1, 2, 3])
    expect(setA.isSubsetOf(setB)).toBe(true)
    expect(setB.isSubsetOf(setA)).toBe(false)
  })

  test('should check if a set is a superset of another', () => {
    const setA = new IndexSet<number>([1, 2, 3])
    const setB = new IndexSet<number>([1, 2])
    expect(setA.isSupersetOf(setB)).toBe(true)
    expect(setB.isSupersetOf(setA)).toBe(false)
  })

  test('should check if two sets are disjoint', () => {
    const setA = new IndexSet<number>([1, 2, 3])
    const setB = new IndexSet<number>([4, 5, 6])
    expect(setA.isDisjointFrom(setB)).toBe(true)

    const setC = new IndexSet<number>([3, 4, 5])
    expect(setA.isDisjointFrom(setC)).toBe(false)
  })
})
