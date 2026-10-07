import { z } from 'zod'
import { hasKey } from '../../../lib'
import { parseUnknown } from '../../../result/lib/parse'
import { colors } from './foundation/colors'
import { fontWeights, newTextStyles } from './foundation/typography'

export type ResolvedTextStyle = {
  fontSize: string
  lineHeight: string
  letterSpacing: string | undefined
  textTransform: string | undefined
}

function isColorGroup(value: unknown): value is object {
  return value !== null && typeof value === 'object'
}

/**
 * Extracts a color from the colors object
 * @param colorPath - The color path (e.g. 'primary.50')
 * @returns The color value (e.g. '#E8EDFB')
 */
export function getColor(colorPath: string): string {
  const pathSegments = colorPath.split('.')

  // Start with the colors object
  let current: unknown = colors

  // Navigate through each path segment
  for (const segment of pathSegments) {
    if (isColorGroup(current) && hasKey(current, segment)) {
      // The guard confirms this is an object containing the key; its value remains unknown.
      current = current[segment]
    } else {
      // Path not found, return the original path or throw an error
      throw new Error(`Color path "${colorPath}" not found in colors`)
    }
  }

  // Ensure we ended up with a string (the actual color value)
  const color = parseUnknown(z.string(), current)
  if (color.isOk()) {
    return color.unwrap()
  } else {
    throw new Error(`Color path "${colorPath}" does not resolve to a color value`)
  }
}

// Typography token extractor

export function getTextStyle(styleName: keyof typeof newTextStyles): ResolvedTextStyle {
  const style = newTextStyles[styleName]
  const letterSpacing = 'letterSpacing' in style ? getValueInPx(style.letterSpacing) : undefined
  const textTransform = 'textTransform' in style ? style.textTransform : undefined

  return {
    fontSize: getValueInPx(style.fontSize),
    lineHeight: getValueInPx(style.lineHeight),
    letterSpacing,
    textTransform,
  }
}
const BASE_FONT_SIZE = 16
function getValueInPx(value: string): string {
  if (!value.endsWith('em')) {
    throw new Error(`Value must be either in em or rem: ${value}`)
  }

  return `${parseFloat(value) * BASE_FONT_SIZE}px`
}

// Font weight extractor
export function getFontWeight(weight: keyof typeof fontWeights): number {
  return fontWeights[weight]
}
