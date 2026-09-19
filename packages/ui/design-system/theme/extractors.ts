import { colors } from './foundation/colors'
import { fontWeights, newTextStyles } from './foundation/typography'

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
    if (current && typeof current === 'object' && segment in current) {
      // The guard confirms this is an object containing the key; its value remains unknown.
      current = (current as Record<string, unknown>)[segment]
    } else {
      // Path not found, return the original path or throw an error
      throw new Error(`Color path "${colorPath}" not found in colors`)
    }
  }

  // Ensure we ended up with a string (the actual color value)
  if (typeof current === 'string') {
    return current
  } else {
    throw new Error(`Color path "${colorPath}" does not resolve to a color value`)
  }
}

// Typography token extractor

export function getTextStyle(styleName: keyof typeof newTextStyles): {
  fontSize: string
  lineHeight: string
  letterSpacing: string | undefined
  textTransform: string | undefined
} {
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
