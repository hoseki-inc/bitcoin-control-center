export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

function hasDefaultExport(module: unknown): module is { default: unknown } {
  return module !== null && (typeof module === 'object' || typeof module === 'function') && 'default' in module
}

/**
 * Resolves CJS default export interop issues when importing CommonJS modules in ESM.
 * Some bundlers/runtimes nest the module under .default, others don't.
 */
export function cjsInterop<T>(module: T): T extends { default: infer U } ? U : T
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The overload implementation must inspect any module shape supplied by a runtime.
export function cjsInterop(module: unknown): unknown {
  if (hasDefaultExport(module)) {
    return module.default ?? module
  }
  return module
}

export function hasKey<K extends PropertyKey>(value: unknown, key: K): value is object & Record<K, unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && key in value
}

/** Read a possibly missing string key without widening the source table's type. */
export function getRecordValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return record[key]
}
