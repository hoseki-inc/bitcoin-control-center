import { expect, it } from 'vitest'
import { loggableError } from './loggable-error'

it('keeps a database error message, which lists the values being saved, out', () => {
  const error = new Error('Failed query: update "statements" set ...\nparams: bc1qsecretaddress,deadbeeftxid')

  const logged = JSON.stringify(loggableError(error))

  expect(logged).not.toContain('bc1qsecretaddress')
  expect(logged).not.toContain('deadbeeftxid')
  expect(loggableError(error).stack).toMatch(/^ {4}at /)
})

it('keeps out message lines that look like stack frames', () => {
  // A wallet name is user text, and can hold a line that looks like a frame.
  const error = new Error('Account "Cold\n    at bc1qsecretaddress" must be verified')

  expect(JSON.stringify(loggableError(error))).not.toContain('bc1qsecretaddress')
})

it('leaves out a stack that does not start with the message', () => {
  const error = new Error('Failed query: params: bc1qsecretaddress')
  error.stack = 'Rewritten\n    at bc1qsecretaddress'

  expect(loggableError(error)).toEqual({ error: 'Error', code: undefined, stack: undefined })
})

it('logs the SQLite code of the database error that caused it', () => {
  const cause = Object.assign(new Error('SQLITE_FULL: database or disk is full'), { code: 'SQLITE_FULL' })

  expect(loggableError(new Error('Failed query', { cause })).code).toBe('SQLITE_FULL')
})
