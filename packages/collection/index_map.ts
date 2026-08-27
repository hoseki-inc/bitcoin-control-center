export type Index = string | number | bigint | boolean | symbol

export type Indexable =
  | Index
  | {
      id?: Index | (() => Index)
      key?: Index | (() => Index)
    }
  | {
      id?: unknown
      key?: unknown
      toString: () => string
    }

export class IndexMap<K extends Indexable, V> implements Map<K, V> {
  /**
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/groupBy
   */
  public static groupBy<T, K extends Indexable>(iterable: Iterable<T>, callbackfn: (item: T) => K): IndexMap<K, T[]> {
    const map = new IndexMap<K, T[]>()
    for (const item of iterable) {
      const key = callbackfn(item)
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return map
  }

  private readonly _map = new Map<Index, [K, V]>()
  public size: number = 0

  public [Symbol.toStringTag] = 'IndexMap'

  /**
   * Creates an IndexMap instance.
   * @param iterable An iterable object whose elements are key-value pairs.
   */
  public constructor(iterable?: Iterable<readonly [K, V]> | null) {
    if (iterable) {
      for (const [key, value] of iterable) {
        this.set(key, value)
      }
    }
  }

  private getIndex(key: K): Index {
    // If key is not an object, use it
    if (typeof key !== 'object') {
      return key
    }

    // If key is provided, use it
    if (key.key !== undefined) {
      const keyValue = typeof key.key === 'function' ? key.key() : key.key
      if (keyValue !== null && keyValue !== undefined) {
        return keyValue
      }
    }

    // If id is provided, use it
    if (key.id !== undefined) {
      const idValue = typeof key.id === 'function' ? key.id() : key.id
      if (idValue !== null && idValue !== undefined) {
        return idValue
      }
    }

    // If neither key nor id are provided, use the string representation of the key
    return key.toString()
  }

  private updateSize(): void {
    this.size = this._map.size
  }

  /**
   * Clears all entries from the IndexMap, resetting its size to zero.
   *
   * @returns {void} This method does not return a value.
   */
  public clear(): void {
    this._map.clear()
    this.updateSize()
  }

  /**
   * Removes the specified key and its associated value from the IndexMap.
   *
   * @param {K} key - The key to remove from the IndexMap.
   * @returns {boolean} Returns true if the key was found and removed, otherwise false.
   */
  public delete(key: K): boolean {
    const index = this.getIndex(key)
    const result = this._map.delete(index)
    this.updateSize()
    return result
  }

  /**
   * Executes a provided function once for each key-value pair in the IndexMap.
   *
   * @param {function} callbackfn - The function to execute for each element.
   * @returns {void} This method does not return a value.
   */
  public forEach(callbackfn: (value: V, key: K, map: IndexMap<K, V>) => void): void {
    this._map.forEach(([key, value]) => {
      callbackfn(value, key, this)
    })
  }

  /**
   * Retrieves the value associated with the specified key from the IndexMap.
   * If the key is not found, it returns undefined.
   *
   * @param {K} key - The key to retrieve the value for.
   * @returns {V | undefined} Returns the value associated with the key, or undefined if the key is not found.
   */
  public get(key: K): V | undefined {
    const index = this.getIndex(key)
    const result = this._map.get(index)
    return result ? result[1] : undefined
  }

  /**
   * Checks if the IndexMap contains a key-value pair with the specified key.
   *
   * @param {K} key - The key to check for existence in the IndexMap.
   * @returns {boolean} Returns true if the key is found, otherwise false.
   */
  public has(key: K): boolean {
    const index = this.getIndex(key)
    return this._map.has(index)
  }

  /**
   * Sets the value for the specified key in the IndexMap.
   *
   * @param {K} key - The key to set the value for.
   * @param {V} value - The value to set for the key.
   * @returns {this} Returns the IndexMap instance.
   */
  public set(key: K, value: V): this {
    const index = this.getIndex(key)
    this._map.set(index, [key, value])
    this.updateSize()
    return this
  }

  /**
   * Returns an iterable of key-value pairs for every entry in the IndexMap.
   *
   * @returns {IterableIterator<[K, V]>} An iterator that yields key-value pairs.
   */
  public *entries(): IterableIterator<[K, V]> {
    for (const [key, value] of this._map.values()) {
      yield [key, value]
    }
  }

  /**
   * Returns an iterable of keys for every entry in the IndexMap.
   *
   * @returns {IterableIterator<K>} An iterator that yields keys.
   */
  public *keys(): IterableIterator<K> {
    for (const [key] of this._map.values()) {
      yield key
    }
  }

  /**
   * Returns an iterable of values for every entry in the IndexMap.
   *
   * @returns {IterableIterator<V>} An iterator that yields values.
   */
  public *values(): IterableIterator<V> {
    for (const [, value] of this._map.values()) {
      yield value
    }
  }

  /**
   * Returns an iterator that yields key-value pairs from the IndexMap.
   *
   * @returns {IterableIterator<[K, V]>} An iterator that yields key-value pairs.
   */
  public [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries()
  }

  public toJSON(): Record<string, V> {
    const rec: Record<string, V> = {}
    for (const [key, value] of this.entries()) {
      rec[this.getIndex(key).toString()] = value
    }
    return rec
  }

  public toString(): string {
    return JSON.stringify(this.toJSON())
  }
}

export interface ReadonlyIndexMap<K extends Indexable, V> extends ReadonlyMap<K, V> {}
