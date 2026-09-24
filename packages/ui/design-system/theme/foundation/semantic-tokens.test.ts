import { describe, expect, it } from 'vitest'
import { colors } from './colors'
import { semanticColors } from './semantic-tokens'

type ModeValue = { default: string; _dark: string }

function isModeValue(value: unknown): value is ModeValue {
  return typeof value === 'object' && value !== null && 'default' in value && '_dark' in value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function collect(node: Record<string, unknown>, path: string[] = []): Array<[string, ModeValue]> {
  return Object.entries(node).flatMap(([key, value]) =>
    isModeValue(value)
      ? [[[...path, key].join('.'), value] as [string, ModeValue]]
      : isRecord(value)
        ? collect(value, [...path, key])
        : [],
  )
}

function resolves(value: string): boolean {
  if (/^(#|rgba?\(|hsla?\(|color-mix\()/.test(value)) {
    return true
  }
  const [palette = '', step = ''] = value.split('.')
  const scale: unknown = Reflect.get(colors, palette)
  return isRecord(scale) && scale[step] !== undefined
}

const tokens = collect(semanticColors)

describe('semantic colour tokens', () => {
  it('defines a light and a dark value for every role', () => {
    expect(tokens.length).toBeGreaterThan(40)
    for (const [name, value] of tokens) {
      expect(value.default, `${name} light`).toBeTruthy()
      expect(value._dark, `${name} dark`).toBeTruthy()
    }
  })

  it.each(tokens)('%s references colours that exist in both modes', (_name, value) => {
    expect(resolves(value.default)).toBe(true)
    expect(resolves(value._dark)).toBe(true)
  })

  it('avoids the reserved "default" key so Chakra does not mistake a role group for a mode value', () => {
    for (const [name] of tokens) {
      expect(name.split('.')).not.toContain('default')
    }
  })
})
