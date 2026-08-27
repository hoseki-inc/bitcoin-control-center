export function isNullish<TValue>(value: TValue | null | undefined): value is null | undefined {
  return value === null || value === undefined
}

/**
 * Resolves CJS default export interop issues when importing CommonJS modules in ESM.
 * Some bundlers/runtimes nest the module under .default, others don't.
 */
export function cjsInterop<T>(module: T): T extends { default: infer U } ? U : T {
  return ((module as { default?: unknown }).default ?? module) as T extends { default: infer U } ? U : T
}
