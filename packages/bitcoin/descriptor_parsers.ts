import { Err, Ok, type Result } from '@hoseki/packages/result'
import { z } from 'zod'
import { parse, parseUnknown } from '../result'
import type { MultiSigAccountScriptType, SingleSigAccountScriptType } from './account_props'
import { derivationPathSchema } from './derivation-path'
import * as descriptorUtils from './descriptor_utils'
import { InvalidFormatError } from './errors'
import { KeyExpression, KeyOrigin, keyFingerprintSchema } from './key-expression'
import { parseRecursiveParenthesisDescent } from './util/parse'
import { Xpub } from './xpub'

type ParsedDescriptorKey = {
  keyOrigin: {
    fingerprint: string
    derivationPath: string | null
  } | null
  xpub: string
}

/**
 * Base class for account descriptor parsing with shared functionality.
 */
abstract class BaseAccountDescriptorParser {
  /**
   * Validates descriptor checksum if present.
   * @param desc Descriptor string without checksum
   * @param checksum Expected checksum
   * @returns Ok if valid or no checksum, Err if checksum validation fails
   */
  protected static assertChecksum(desc: string, checksum: string | undefined): Result<void, Error> {
    if (checksum != null && checksum !== '') {
      const checksumResult = descriptorUtils.getChecksum(desc)
      if (checksumResult.isErr()) {
        return Err(checksumResult.unwrapErr())
      }
      if (checksumResult.unwrap() !== checksum) {
        return Err(new Error('Checksums do not match'))
      }
    }
    return Ok(undefined)
  }

  /**
   * Transforms parts of keyExpression string into object.
   * @param keyExpressionStr Example: '[00000000/84h/0h/0h]xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr/<0;1>/*'
   * @returns Parts structured into object
   */
  protected static transformKey(keyExpressionStr: string): ParsedDescriptorKey {
    const bracketRegex = /\[(.*?)\]/ // match `[<everything>]`
    const originResult = bracketRegex.exec(keyExpressionStr)

    const keyOriginWithBrackets = originResult?.[0]
    const keyOriginWithoutBrackets = originResult?.[1]

    const keyDescriptorWithoutOrigin =
      keyOriginWithBrackets != null && keyOriginWithBrackets !== ''
        ? keyExpressionStr.replace(keyOriginWithBrackets, '')
        : keyExpressionStr

    // Get /0/* or /<0;1>/*
    const receivePath = keyDescriptorWithoutOrigin.substring(keyDescriptorWithoutOrigin.indexOf('/'))
    const justXpub = keyDescriptorWithoutOrigin.replace(receivePath, '')
    const [fingerprint, ...derivationPathStart] = keyOriginWithoutBrackets?.split('/') ?? []
    const nonEmptyDerivationPath = derivationPathStart.filter((segment) => segment.length > 0)

    return {
      keyOrigin:
        fingerprint != null && fingerprint !== ''
          ? {
              fingerprint,
              derivationPath: nonEmptyDerivationPath.length ? `m/${nonEmptyDerivationPath.join('/')}` : null,
            }
          : null,
      xpub: justXpub,
    }
  }
}

/**
 * Single sig
 */

export type SinglesigProps = {
  scriptType: SingleSigAccountScriptType
  keyExpression: KeyExpression
}

const SinglesigAccountDescriptorSchema = z
  .object({
    keyExpression: z
      .object({
        keyOrigin: z
          .object({
            fingerprint: keyFingerprintSchema.nullable(),
            derivationPath: derivationPathSchema.nullable(),
          })
          .nullable()
          .transform((origin) => {
            if (!origin?.fingerprint) {
              return null
            }
            return KeyOrigin.from(origin.fingerprint, origin.derivationPath)
          }),
        xpub: z.string().transform((xpub, ctx) => {
          const result = Xpub.fromString(xpub)
          if (result.isErr()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: result.unwrapErr().message,
            })
            return z.NEVER
          }
          return result.unwrap()
        }),
      })
      .transform(({ keyOrigin, xpub }) => {
        return KeyExpression.from(xpub, keyOrigin)
      }),

    scriptTypeFactors: z.array(z.enum(['pkh', 'sh', 'wpkh', 'tr'])).transform((factors, ctx) => {
      if (!factors.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'No script type factors provided',
        })
        return z.NEVER
      }

      const uniqueElements = new Set()
      for (const factor of factors) {
        if (uniqueElements.has(factor)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Duplicated script type factors',
          })
          return z.NEVER
        }
        uniqueElements.add(factor)
      }

      const scriptType = (
        {
          pkh: 'p2pkh',
          'sh-wpkh': 'p2sh-p2wpkh',
          wpkh: 'p2wpkh',
          tr: 'p2tr',
        } satisfies Record<string, SingleSigAccountScriptType>
      )[factors.join('-')]

      if (!scriptType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Undefined script type`,
        })
        return z.NEVER
      }

      return scriptType
    }),
  })
  .transform(({ scriptTypeFactors, keyExpression }) => ({
    scriptType: scriptTypeFactors,
    keyExpression,
  }))

export class SinglesigDescriptorParser extends BaseAccountDescriptorParser {
  public static parse(string: string): Result<SinglesigProps, Error> {
    const [desc, checksum] = string.split('#')

    if (desc == null || desc === '') {
      return Err(new Error('Empty script string'))
    }

    const transformedDescriptorResult = SinglesigDescriptorParser.transformOutputDescriptor(desc)
    if (transformedDescriptorResult.isErr()) {
      return Err(transformedDescriptorResult.unwrapErr())
    }

    const parseResult = parse(SinglesigAccountDescriptorSchema, transformedDescriptorResult.unwrap())
    if (parseResult.isErr()) {
      return Err(parseResult.unwrapErr())
    }

    const checksumResult = this.assertChecksum(desc, checksum)
    if (checksumResult.isErr()) {
      return Err(checksumResult.unwrapErr())
    }

    return Ok(parseResult.unwrap())
  }

  /**
   * Transforms parts of output descriptor string into object. Returns `InvalidFormatError` if
   * expected part is missing or in wrong format.
   * @param descriptor Output descriptor, example: 'wpkh([00000000/84h/0h/0h]xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr/<0;1>/*)'
   * @returns Parts structured into object or `InvalidFormatError`
   */
  public static transformOutputDescriptor(descriptor: string): Result<
    {
      keyExpression: {
        keyOrigin: {
          fingerprint: string
          derivationPath: string | null
        } | null
        xpub: string
      }
      scriptTypeFactors: Array<'pkh' | 'sh' | 'wpkh' | 'tr'>
    },
    InvalidFormatError
  > {
    if (!descriptor) {
      return Err(new InvalidFormatError('Empty script string'))
    }

    const cleanedDescriptor = descriptor.replace(/\s/g, '') // remove whitespace

    // Parse the outermost script wrapper(s) to determine script type
    const scriptTypeFactors: Array<'pkh' | 'sh' | 'wpkh' | 'tr'> = []

    let remaining = cleanedDescriptor

    // Handle nested scripts: sh(wpkh(...)) or just wpkh(...)
    // Strip outer scripts and collect them
    for (;;) {
      // Check for script patterns: pkh, wpkh, tr, sh
      if (remaining.startsWith('pkh(')) {
        scriptTypeFactors.push('pkh')
        remaining = remaining.slice(4, -1) // Remove 'pkh(' and trailing ')'
        break
      } else if (remaining.startsWith('wpkh(')) {
        scriptTypeFactors.push('wpkh')
        remaining = remaining.slice(5, -1) // Remove 'wpkh(' and trailing ')'
        break
      } else if (remaining.startsWith('tr(')) {
        scriptTypeFactors.push('tr')
        remaining = remaining.slice(3, -1) // Remove 'tr(' and trailing ')'
        break
      } else if (remaining.startsWith('sh(')) {
        scriptTypeFactors.push('sh')
        remaining = remaining.slice(3, -1) // Remove 'sh(' and trailing ')'
        // Continue to check for nested wpkh
      } else {
        return Err(new InvalidFormatError('Unrecognized script type'))
      }
    }

    if (!scriptTypeFactors.length) {
      return Err(new InvalidFormatError('No script type factors found'))
    }

    // Now `remaining` should be the key expression: [origin]xpub/<0;1>/* or [origin]xpub/0/*
    const keyExpression = this.transformKey(remaining)

    return Ok({
      keyExpression,
      scriptTypeFactors,
    })
  }
}

/**
 * Multisig
 */

export type MultisigProps = {
  scriptType: MultiSigAccountScriptType
  threshold: number
  isSorted: boolean
  keyExpressions: KeyExpression[]
}

const MultisigAccountDescriptorSchema = z
  .object({
    threshold: z.coerce.number(),
    keyExpressions: z
      .object({
        keyOrigin: z
          .object({
            fingerprint: keyFingerprintSchema.nullable(),
            derivationPath: derivationPathSchema.nullable(),
          })
          .nullable()
          .transform((origin) => {
            if (!origin?.fingerprint) {
              return null
            }
            return KeyOrigin.from(origin.fingerprint, origin.derivationPath)
          }),
        xpub: z.string().transform((xpub, ctx) => {
          const result = Xpub.fromString(xpub)
          if (result.isErr()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: result.unwrapErr().message,
            })
            return z.NEVER
          }
          return result.unwrap()
        }),
      })
      .transform(({ keyOrigin, xpub }) => {
        return KeyExpression.from(xpub, keyOrigin)
      })
      .array(),

    multiScript: z.enum(['multi', 'sortedmulti']),

    scriptTypeFactors: z.array(z.enum(['sh', 'wsh', 'tr'])).transform((factors, ctx) => {
      if (!factors.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'No script type factors provided',
        })
        return z.NEVER
      }

      const uniqueElements = new Set()
      for (const factor of factors) {
        if (uniqueElements.has(factor)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Duplicated script type factors',
          })
          return z.NEVER
        }
        uniqueElements.add(factor)
      }

      const scriptType = (
        {
          'sh-wsh': 'p2sh-p2wsh',
          wsh: 'p2wsh',
          sh: 'p2sh',
        } satisfies Record<string, MultiSigAccountScriptType>
      )[factors.join('-')]

      if (!scriptType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Undefined script type`,
        })
        return z.NEVER
      }

      return scriptType
    }),
  })
  .transform(({ multiScript, scriptTypeFactors, keyExpressions, threshold }) => ({
    threshold,
    keyExpressions,
    // renaming to more suitable names
    isSorted: multiScript === 'sortedmulti',
    scriptType: scriptTypeFactors,
  }))

export class MultisigDescriptorParser extends BaseAccountDescriptorParser {
  public static parse(string: string): Result<MultisigProps, Error> {
    const [desc, checksum] = string.split('#')

    if (desc == null || desc === '') {
      return Err(new Error('Empty script string'))
    }
    const transformedDescriptorResult = MultisigDescriptorParser.transformOutputDescriptor(desc)
    if (transformedDescriptorResult.isErr()) {
      return Err(transformedDescriptorResult.unwrapErr())
    }

    // if we try to use `parse`, there will be a TS error
    // I guess it doesn't work well with z.coerce.number(),
    // I also tried to convert with z.string().transform(...), no success
    const parseResult = parseUnknown(MultisigAccountDescriptorSchema, transformedDescriptorResult.unwrap())
    if (parseResult.isErr()) {
      return Err(parseResult.unwrapErr())
    }

    const checksumResult = this.assertChecksum(desc, checksum)
    if (checksumResult.isErr()) {
      return Err(checksumResult.unwrapErr())
    }

    return Ok(parseResult.unwrap())
  }

  /**
   * Transforms parts of output descriptor string into object. Returns `InvalidFormatError` if
   * expected part is missing or in wrong format.
   * @param descriptor Output descriptor, example: 'sh(wsh(sortedmulti(2,[00000000/49/0/0]xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ/<0;1>/*,[00000000/49/0/0]xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j/<0;1>/*,[00000000/49/0/0]xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m/<0;1>/*)))#mkl9ckkl'
   * @returns Parts structured into object or `InvalidFormatError`
   */
  public static transformOutputDescriptor(descriptor: string): Result<
    {
      threshold: string
      keyExpressions: Array<{
        keyOrigin: {
          fingerprint: string
          derivationPath: string | null
        } | null
        xpub: string
      }>
      multiScript: string
      scriptTypeFactors: string[]
    },
    InvalidFormatError
  > {
    if (!descriptor) {
      return Err(new InvalidFormatError('Empty script string'))
    }

    const parsedDescentResult = parseRecursiveParenthesisDescent(descriptor.replace(/\s/g, ''))
    if (parsedDescentResult.isErr()) {
      return Err(parsedDescentResult.unwrapErr())
    }

    // Reversing the array because `scriptTypeFactors.length` is variable,
    // I want to keep the access to other elements in `parseDescentResult.value` predictable
    const reversedParsedDescent = parsedDescentResult.unwrap().reverse()
    const [thresholdAndKeyExpressionStr, multiScript, ...reversedScriptTypeFactors] = reversedParsedDescent
    const scriptTypeFactors = reversedScriptTypeFactors.reverse()
    if (thresholdAndKeyExpressionStr == null || thresholdAndKeyExpressionStr === '') {
      return Err(new InvalidFormatError('Number of required keys and keyOrigin are empty'))
    }
    if (multiScript == null || multiScript === '') {
      return Err(new InvalidFormatError('Empty multi script type'))
    }
    if (!scriptTypeFactors.length || !scriptTypeFactors.every(Boolean)) {
      return Err(new InvalidFormatError('Missing script type factors'))
    }

    const [threshold, ...keyExpressionStr] = thresholdAndKeyExpressionStr.split(',')
    if (threshold == null || threshold === '') {
      return Err(new InvalidFormatError('Number of required keys is empty'))
    }
    if (!keyExpressionStr.length || !keyExpressionStr.every(Boolean)) {
      return Err(new InvalidFormatError('keyOrigin are empty'))
    }

    const keyExpressions: Array<{
      keyOrigin: {
        fingerprint: string
        derivationPath: string | null
      } | null
      xpub: string
    }> = []
    for (const str of keyExpressionStr) {
      const keyParsingResult = this.transformKey(str)
      keyExpressions.push(keyParsingResult)
    }

    return Ok({
      threshold,
      keyExpressions,
      multiScript,
      scriptTypeFactors,
    })
  }
}
