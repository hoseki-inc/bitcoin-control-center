import { Err, Ok, type Result } from '../../result'
import { InvalidFormatError } from '../errors'

/**
 * Break a string with nested pairs of parenthesis into an array containing from the
 * shallowest (including those outside parenthesis) to the deeper content.
 * @param outputDescriptor Output descriptor
 * @returns Array
 */
export function parseRecursiveParenthesisDescent(outputDescriptor: string): Result<string[], InvalidFormatError> {
  const levels: string[][] = []
  let depth: number = 0
  for (const char of outputDescriptor) {
    if (char === '(') depth++

    if (depth >= levels.length) levels.push([])

    // Insert content character, but keep parenthesis out of final values
    if (char !== ')' && char !== '(') levels[depth]?.push(char)

    if (char === ')') {
      if (depth <= 0) return Err(new InvalidFormatError('Parenthesis pairs are not valid'))
      depth--
    }
  }
  return Ok(levels.map((level) => level.join('')))
}
