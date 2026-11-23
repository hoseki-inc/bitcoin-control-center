import { HardwareDeviceError } from '@hoseki/packages/wallet'
import { TRPCClientError } from '@trpc/client'
import { toast } from 'sonner'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { badRequest, internalError, notFound } from '../testing/trpc'
import {
  getSigningErrorMessage,
  hardwareSigningErrorMessage,
  signingErrorReason,
  toastSigningError,
} from './signing-error-message'

const LOCAL_SERVER_NETWORK_COPY =
  "Can't connect to Control Center's local server. Check that Control Center is running, then try again."

describe('signingErrorReason', () => {
  it('returns the message for BAD_REQUEST Invalid signature', () => {
    expect(signingErrorReason(badRequest('Invalid signature'))).toBe('Invalid signature')
  })

  it('returns trimmed messages for NOT_FOUND and BAD_REQUEST errors', () => {
    expect(signingErrorReason(notFound('  Signed message not found  '))).toBe('Signed message not found')
    expect(signingErrorReason(badRequest('  Challenge already completed\t'))).toBe('Challenge already completed')
  })

  it('accepts BAD_REQUEST when httpStatus is omitted', () => {
    const error = TRPCClientError.from({
      error: { message: 'Invalid signature', code: -32600, data: { code: 'BAD_REQUEST' } },
    })
    expect(signingErrorReason(error)).toBe('Invalid signature')
  })

  it.each([
    'Signed message already completed',
    'Signing address does not match the account key',
    'Not all messages have been signed',
    'No signed messages found',
    'Archived claims cannot complete verification',
    'Challenge is not satisfied',
  ])('returns known BAD_REQUEST completion literal: %s', (message) => {
    expect(signingErrorReason(badRequest(message))).toBe(message)
  })

  it.each(['Challenge not found', 'Signed message not found', 'Account not found'])(
    'returns known NOT_FOUND completion literal: %s',
    (message) => {
      expect(signingErrorReason(notFound(message))).toBe(message)
    },
  )

  it.each(['', '   ', '\t'])('returns undefined for empty or whitespace BAD_REQUEST message: %j', (message) => {
    expect(signingErrorReason(badRequest(message))).toBeUndefined()
  })

  it.each(['SQLITE_BUSY: database is locked', 'Failed to parse account descriptor', 'Failed to fetch'])(
    'returns undefined for INTERNAL_SERVER_ERROR: %s',
    (message) => {
      expect(signingErrorReason(internalError(message))).toBeUndefined()
    },
  )

  it.each([
    ['UNAUTHORIZED', 401, 'Enter your PIN'],
    ['FORBIDDEN', 403, 'Access denied'],
    ['BAD_REQUEST', 500, 'Invalid signature'],
  ] as const)('returns undefined for %s with httpStatus %d', (code, httpStatus, message) => {
    const error = TRPCClientError.from({
      error: { message, code: -32001, data: { code, httpStatus } },
    })
    expect(signingErrorReason(error)).toBeUndefined()
  })

  it.each(['Failed to fetch', 'Load failed'])(
    'returns local-server copy for unshaped TRPCClientError network failure: %s',
    (message) => {
      expect(signingErrorReason(TRPCClientError.from(new Error(message)))).toBe(LOCAL_SERVER_NETWORK_COPY)
    },
  )

  it.each(['Failed to fetch', 'Load failed'])(
    'returns local-server copy for plain Error network failure: %s',
    (message) => {
      expect(signingErrorReason(new Error(message))).toBe(LOCAL_SERVER_NETWORK_COPY)
    },
  )

  it('returns undefined for unshaped non-network errors and non-Error values', () => {
    expect(signingErrorReason(TRPCClientError.from(new Error('Invalid signature')))).toBeUndefined()
    expect(signingErrorReason(new Error('Invalid signature'))).toBeUndefined()
    expect(signingErrorReason('Invalid signature')).toBeUndefined()
    expect(signingErrorReason(null)).toBeUndefined()
    expect(signingErrorReason(undefined)).toBeUndefined()
  })

  it.each([
    'Invalid signature\n-----BEGIN BITCOIN SIGNATURE-----',
    'Invalid signature\r\nmore details',
    '{"error":"bad"}',
    '["Invalid signature"]',
    '<html><body>Bad Request</body></html>',
    'Failed at verifySignedMessageSignature (router.ts:96:11)',
    'at fn (file.ts:1:1)',
    'SQLITE_CONSTRAINT: unique failed',
    'ENOENT: no such file',
    'ECONNREFUSED 127.0.0.1:50001',
    'EPIPE: broken pipe',
    'TypeError: cannot read properties of undefined',
    'ReferenceError: x is not defined',
    'SyntaxError: unexpected token',
    'RangeError: invalid length',
    'Error: unexpected failure',
    'a'.repeat(201),
  ])('drops unsafe BAD_REQUEST message: %s', (message) => {
    expect(signingErrorReason(badRequest(message))).toBeUndefined()
  })

  it.each([
    'No "mutation"-procedure on path "portalProve.registry.challenges.complete"',
    'No "query"-procedure on path "portalProve.registry.challenges.get"',
    'No "subscription"-procedure on path "portalProve.registry.challenges.watch"',
  ])('drops tRPC missing-procedure NOT_FOUND diagnostic: %s', (message) => {
    expect(signingErrorReason(notFound(message))).toBeUndefined()
  })

  it('keeps a safe BAD_REQUEST message at the 200-character limit', () => {
    const message = 'a'.repeat(200)
    expect(signingErrorReason(badRequest(message))).toBe(message)
  })
})

describe('getSigningErrorMessage', () => {
  it('returns the safe reason when present and the fallback otherwise', () => {
    expect(getSigningErrorMessage(badRequest('Invalid signature'), 'Error completing challenge message')).toBe(
      'Invalid signature',
    )
    expect(
      getSigningErrorMessage(internalError('SQLITE_BUSY: database is locked'), 'Error completing challenge message'),
    ).toBe('Error completing challenge message')
  })
})

describe('toastSigningError', () => {
  it('passes description when a distinct safe reason exists', () => {
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    const spy = vi.spyOn(toast, 'error').mockReturnValue('toast-id')

    toastSigningError(badRequest('Invalid signature'), "Couldn't verify this account")

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith("Couldn't verify this account", { description: 'Invalid signature' })
  })

  it('calls toast.error with one argument when falling back or when reason equals title', () => {
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    const spy = vi.spyOn(toast, 'error').mockReturnValue('toast-id')

    toastSigningError(
      internalError('SQLITE_BUSY: database is locked'),
      'The signing process did not complete successfully.',
    )
    toastSigningError(badRequest('Invalid signature'), 'Invalid signature')

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[0]).toEqual(['The signing process did not complete successfully.'])
    expect(spy.mock.calls[1]).toEqual(['Invalid signature'])
  })
})

describe('hardwareSigningErrorMessage', () => {
  it('returns the friendly message for a hardware device error', () => {
    expect(hardwareSigningErrorMessage(new HardwareDeviceError('raw', 'ledger', 'Signing canceled'), 'Fallback')).toBe(
      'Signing canceled',
    )
  })

  it('returns the server reason for BAD_REQUEST', () => {
    expect(hardwareSigningErrorMessage(badRequest('Invalid signature'), 'Fallback')).toBe('Invalid signature')
  })

  it('returns the fallback for an internal server error', () => {
    expect(hardwareSigningErrorMessage(internalError('Failed to parse account descriptor.'), 'Fallback')).toBe(
      'Fallback',
    )
  })

  it('returns the fallback for a plain error', () => {
    expect(hardwareSigningErrorMessage(new Error('Unexpected Trezor failure'), 'Fallback')).toBe('Fallback')
  })
})
