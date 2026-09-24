export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

/**
 * Resolves CJS default export interop issues when importing CommonJS modules in ESM.
 * Some bundlers/runtimes nest the module under .default, others don't.
 */
export function cjsInterop<T>(module: T): T extends { default: infer U } ? U : T
export function cjsInterop(module: unknown): unknown {
  if (module !== null && (typeof module === 'object' || typeof module === 'function') && 'default' in module) {
    return module.default ?? module
  }
  return module
}

export function hasKey<K extends PropertyKey>(value: object, key: K): value is object & Record<K, unknown> {
  return key in value
}

/** Read a possibly missing string key without widening the source table's type. */
export function getRecordValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return record[key]
}
