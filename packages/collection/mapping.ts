import { Option } from '../result'

export type Mappable = {
  key: string | (() => string)
}

function isComputedKey(key: Mappable['key']): key is () => string {
  return typeof key === 'function'
}

/**
 * @deprecated Use `Map` or `IndexMap` instead.
 */
export class Mapping<V extends Mappable> {
  private readonly map: Map<string, V> = new Map()

  public constructor(values?: V[]) {
    if (values) {
      for (const value of values) {
        this.set(value)
      }
    }
  }

  private key(value: V): string {
    return isComputedKey(value.key) ? value.key() : value.key
  }

  public size(): number {
    return this.map.size
  }

  public clear(): void {
    this.map.clear()
  }

  public delete(key: string): boolean {
    return this.map.delete(key)
  }

  public get(key: string): Option<V> {
    return Option.from(this.map.get(key))
  }

  public has(key: string): boolean {
    return this.map.has(key)
  }

  public set(value: V): this {
    this.map.set(this.key(value), value)
    return this
  }

  public keys(): IterableIterator<string> {
    return this.map.keys()
  }

  public values(): IterableIterator<V> {
    return this.map.values()
  }

  public entries(): IterableIterator<[string, V]> {
    return this.map.entries()
  }

  public [Symbol.iterator](): IterableIterator<[string, V]> {
    return this.map.entries()
  }

  public forEach(callbackfn: (value: V, key: string, map: Mapping<V>) => void): void {
    this.map.forEach((value, key) => {
      callbackfn(value, key, this)
    })
  }

  public [Symbol.toStringTag]: string = 'Mapping'

  public toString(): string {
    return `Mapping(${Array.from(this.keys()).join(', ')})`
  }
}
