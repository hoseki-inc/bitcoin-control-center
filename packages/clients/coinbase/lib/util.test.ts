import { describe, expect, it } from 'vitest'
import { recordToFormData, recordToHeaders, recordToSearchParams } from './util'

describe.each([
  { name: 'search params', build: recordToSearchParams, whitespace: ' ' },
  { name: 'form data', build: recordToFormData, whitespace: ' ' },
  { name: 'headers', build: recordToHeaders, whitespace: '' },
])('$name', ({ build, whitespace }) => {
  it('preserves omission of falsy values while retaining truthy strings, numbers, and booleans', () => {
    const result = build({
      missing: undefined,
      nullable: null,
      empty: '',
      zero: 0,
      negativezero: -0,
      nan: NaN,
      disabled: false,
      enabled: true,
      negative: -1,
      positive: 2,
      stringzero: '0',
      stringfalse: 'false',
      whitespace: ' ',
    })

    expect(Object.fromEntries(result)).toEqual({
      enabled: 'true',
      negative: '-1',
      positive: '2',
      stringzero: '0',
      stringfalse: 'false',
      whitespace,
    })
  })
})
