import { Panic, parseError } from '@hoseki/packages/result'
import { expect, it } from 'vitest'

it('creates a Panic without parameters', () => {
  const panic = new Panic()

  expect(panic).toBeInstanceOf(Error)
  expect(panic).toBeInstanceOf(Panic)
  expect(panic.name).toBe('Panic')
  expect(panic.message).toBe('')
  expect(panic.stack).toBeDefined()
  expect(panic.cause).toBeUndefined()
})

it('creates a Panic with a message', () => {
  const message = 'msg'
  const panic = new Panic(message)

  expect(panic).toBeInstanceOf(Error)
  expect(panic).toBeInstanceOf(Panic)
  expect(panic.name).toBe('Panic')
  expect(panic.message).toBe(message)
  expect(panic.stack).toBeDefined()
  expect(panic.cause).toBeUndefined()
})

it('creates a Panic with an Error cause', () => {
  const message = 'panic message'
  const cause = new Error('error message')
  const panic = new Panic(message, { cause })

  expect(panic).toBeInstanceOf(Error)
  expect(panic).toBeInstanceOf(Panic)
  expect(panic.name).toBe('Panic')
  expect(panic.message).toBe(message)
  expect(panic.stack).toBeDefined()
  expect(panic.cause).toBe(cause)

  cause.name = 'MyError'
  expect(new Panic(message, { cause }).stack).toBeDefined()
})

it('creates a Panic with an unknown cause', () => {
  const message = 'panic message'
  const cause = 'string cause'
  const panic = new Panic(message, { cause })

  expect(panic).toBeInstanceOf(Error)
  expect(panic).toBeInstanceOf(Panic)
  expect(panic.name).toBe('Panic')
  expect(panic.message).toBe(message)
  expect(panic.stack).toBeDefined()
  expect(panic.cause).toBe(cause)
})

it('parses unknown errors into TypeErrors', () => {
  const causes: unknown[] = [1, 'str', true, undefined, null, {}, [], new Date()]

  for (const cause of causes) {
    expect(parseError(cause)).toBeInstanceOf(TypeError)
  }
})
