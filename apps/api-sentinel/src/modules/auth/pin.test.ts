import { parse } from '@hoseki/packages/result/lib/parse'
import { describe, expect, it } from 'vitest'
import { Pin, hashPin, verifyPin } from './pin'

function pin(value: string): Pin {
  return parse(Pin, value).expect('a PIN')
}

describe('Pin', () => {
  it('accepts exactly six ASCII digits', () => {
    expect(parse(Pin, '012345').isOk()).toBe(true)
  })

  it.each(['12345', '1234567', '12345a', '123 456', '123-456', ' 123456', '١٢٣٤٥٦', ''])('rejects %j', (value) => {
    expect(parse(Pin, value).unwrapErr().message).toBe('The PIN must be exactly 6 digits')
  })
})

describe('PIN hashes', () => {
  it('verify the PIN they were made from, and no other', async () => {
    const hash = await hashPin(pin('482915'))
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/)
    expect(hash).not.toContain('482915')
    await expect(verifyPin(pin('482915'), hash)).resolves.toBe(true)
    await expect(verifyPin(pin('482916'), hash)).resolves.toBe(false)
  })

  it('use a new salt each time', async () => {
    const first = await hashPin(pin('482915'))
    await expect(hashPin(pin('482915'))).resolves.not.toBe(first)
  })

  it.each(['', 'bcrypt$1$2$3$a$b', 'scrypt$x$8$1$a$b', 'scrypt$32768$8$1$AAAA$AAAA'])(
    'treat an unreadable hash %j as a wrong PIN',
    async (stored) => {
      await expect(verifyPin(pin('482915'), stored)).resolves.toBe(false)
    },
  )
})
