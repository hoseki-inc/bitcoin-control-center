type PluralObject = { singular: string; plural: string; count: number }
type PluralTuple = readonly [singular: string, plural: string, count: number]
type PluralValue = number | string | PluralObject | PluralTuple

function isPluralObject(value: PluralValue | undefined): value is PluralObject {
  return (
    typeof value === 'object' && !Array.isArray(value) && 'count' in value && 'singular' in value && 'plural' in value
  )
}

function isPluralTuple(value: PluralValue | undefined): value is PluralTuple {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string' &&
    typeof value[2] === 'number'
  )
}

/**
 * Utility function to help pluralize a string.
 *
 * @example Pass a tuple of strings and a number
 * ```ts
 * const requester = 'John'
 * const claimCount = 1
 * pluralize`Hey! ${['Your claim is', 'Your claims are', claimCount]} being shared with ${requester}!`
 * // 'Hey! Your claim is being shared with John!'
 * ```
 *
 * @example Pass an object with singular and plural strings and a count
 * ```ts
 * const claimCount = 2
 * pluralize`You have ${claimCount} ${{ singular: 'claim', plural: 'claims', count: claimCount }}`
 * // 'You have 2 claims'
 * ```
 *
 * @returns The interpolated string.
 */
export function pluralize(strings: TemplateStringsArray, ...values: PluralValue[]): string {
  let result = ''
  for (let i = 0; i < strings.length; i++) {
    result += strings[i]
    if (i < values.length) {
      const value = values[i]
      if (isPluralObject(value)) {
        // Object format
        result += value.count === 1 ? value.singular : value.plural
      } else if (isPluralTuple(value)) {
        // Tuple format
        result += value[2] === 1 ? value[0] : value[1]
      } else {
        result += String(value) // Regular interpolation
      }
    }
  }
  return result
}

export function capitalize<T extends string>(str: T): Capitalize<T>
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function convertToOrdinalWords(number: number): string {
  const ordinals = [
    'zeroth',
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
    'eleventh',
    'twelfth',
    'thirteenth',
    'fourteenth',
    'fifteenth',
    'sixteenth',
    'seventeenth',
    'eighteenth',
    'nineteenth',
    'twentieth',
  ]

  if (number >= 0 && number < ordinals.length) {
    const r = ordinals[number]
    if (r == null || r === '') {
      // This should never happen, but we'll add a guard to satisfy the type checker
      throw new Error(`Ordinal ${number} is out of range`)
    }
    return r
  } else {
    // For numbers beyond the pre-defined list, append the appropriate suffix
    const lastDigit = number % 10
    const lastTwoDigits = number % 100

    if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
      return number + 'th'
    } else if (lastDigit === 1) {
      return number + 'st'
    } else if (lastDigit === 2) {
      return number + 'nd'
    } else if (lastDigit === 3) {
      return number + 'rd'
    } else {
      return number + 'th'
    }
  }
}
