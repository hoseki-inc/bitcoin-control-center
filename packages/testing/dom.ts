import { assert } from 'vitest'

/** The element a query found, checked to be the expected kind; the test fails otherwise. */
export function expectElement<T extends Element>(
  found: Element | null | undefined,
  type: abstract new () => T,
  what: string = type.name,
): T {
  assert(found instanceof type, `Expected ${what}`)
  return found
}
