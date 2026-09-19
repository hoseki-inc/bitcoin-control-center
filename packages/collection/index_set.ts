import { IndexMap, type Indexable } from './index_map'

export class IndexSet<T extends Indexable> implements Set<T> {
  private readonly _map = new IndexMap<T, T>()
  public size: number = 0

  public [Symbol.toStringTag] = 'IndexSet'

  /**
   * Creates an instance of IndexSet.
   * @param iterable An optional iterable of values to initialize the set.
   */
  public constructor(iterable?: Iterable<T> | null) {
    if (iterable) {
      for (const key of iterable) {
        this.add(key)
      }
    }
  }

  /**
   * Updates the size of the set based on the current number of entries.
   */
  private updateSize(): void {
    this.size = this._map.size
  }

  /**
   * Clears all entries from the IndexSet, resetting its size to zero.
   */
  public clear(): void {
    this._map.clear()
    this.updateSize()
  }

  /**
   * Adds a value to the IndexSet. If the value already exists, it will not be added again.
   * @param value The value to add to the set.
   * @returns The IndexSet instance.
   */
  public add(value: T): this {
    const current = this._map.get(value)
    if (current !== value) {
      this._map.set(value, value)
    }
    this.updateSize()
    return this
  }

  /**
   * Removes a value from the IndexSet.
   * @param value The value to remove from the set.
   * @returns True if the value was found and removed, otherwise false.
   */
  public delete(value: T): boolean {
    const result = this._map.delete(value)
    this.updateSize()
    return result
  }

  /**
   * Checks if a value exists in the IndexSet.
   * @param value The value to check for existence in the set.
   * @returns True if the value exists, otherwise false.
   */
  public has(value: T): boolean {
    return this._map.has(value)
  }

  /**
   * Executes a provided function once for each value in the IndexSet.
   * @param callbackfn The function to execute for each element.
   */
  public forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void): void {
    this._map.forEach((_, value) => {
      callbackfn(value, value, this)
    })
  }

  /**
   * Returns an iterable of key-value pairs in the IndexSet.
   * @returns An iterable of entries in the form of [value, value].
   */
  public entries(): IterableIterator<[T, T]> {
    return this._map.entries()
  }

  /**
   * Returns an iterable of keys in the IndexSet.
   * @returns An iterable of values in the set.
   */
  public keys(): IterableIterator<T> {
    return this.values()
  }

  /**
   * Returns an iterable of values in the IndexSet.
   * @returns An iterable of values in the set.
   */
  public values(): IterableIterator<T> {
    return this._map.values()
  }

  /**
   * Returns an iterator for the IndexSet.
   * @returns An iterable iterator of values in the set.
   */
  public [Symbol.iterator](): IterableIterator<T> {
    return this.values()
  }

  /**
   * Computes the difference between this set and another set.
   * @param other The other IndexSet to compare against.
   * @returns A new IndexSet containing values that are in this set but not in the other.
   */
  public difference(other: IndexSet<T>): IndexSet<T> {
    const set = new IndexSet<T>()
    for (const value of this) {
      if (!other.has(value)) {
        set.add(value)
      }
    }
    return set
  }

  /**
   * Computes the intersection of this set with another set.
   * @param other The other IndexSet to compare against.
   * @returns A new IndexSet containing values that are present in both sets.
   */
  public intersection(other: IndexSet<T>): IndexSet<T> {
    const set = new IndexSet<T>()
    const [smaller, larger] = this.size < other.size ? [this, other] : [other, this]
    for (const value of smaller) {
      if (larger.has(value)) {
        set.add(value)
      }
    }
    return set
  }

  /**
   * Computes the symmetric difference between this set and another set.
   * @param other The other IndexSet to compare against.
   * @returns A new IndexSet containing values that are in either set but not in both.
   */
  public symmetricDifference(other: IndexSet<T>): IndexSet<T> {
    const set = new IndexSet<T>()
    for (const value of this) {
      if (!other.has(value)) {
        set.add(value)
      }
    }
    for (const value of other) {
      if (!this.has(value)) {
        set.add(value)
      }
    }
    return set
  }

  /**
   * Computes the union of this set with another set.
   * @param other The other IndexSet to combine with.
   * @returns A new IndexSet containing all values from both sets.
   */
  public union(other: IndexSet<T>): IndexSet<T> {
    const set = new IndexSet<T>(this)
    for (const value of other) {
      set.add(value)
    }
    return set
  }

  /**
   * Checks if this set is disjoint from another set.
   * @param other The other IndexSet to compare against.
   * @returns True if there are no common elements, otherwise false.
   */
  public isDisjointFrom(other: IndexSet<T>): boolean {
    return this.intersection(other).size === 0
  }

  /**
   * Checks if this set is a subset of another set.
   * @param other The other IndexSet to compare against.
   * @returns True if this set is a subset of the other, otherwise false.
   */
  public isSubsetOf(other: IndexSet<T>): boolean {
    return this.intersection(other).size === this.size
  }

  /**
   * Checks if this set is a superset of another set.
   * @param other The other IndexSet to compare against.
   * @returns True if this set contains all elements of the other, otherwise false.
   */
  public isSupersetOf(other: IndexSet<T>): boolean {
    return other.isSubsetOf(this)
  }

  public toJSON(): T[] {
    return Array.from(this)
  }

  public toString(): string {
    return JSON.stringify(this.toJSON())
  }
}

export interface ReadonlyIndexSet<T extends Indexable> extends ReadonlySet<T> {}
