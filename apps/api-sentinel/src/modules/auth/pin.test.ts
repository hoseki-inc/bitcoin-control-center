import { describe, expect, it } from 'vitest'
import { hashPin, isPin, verifyPin } from './pin'

describe('isPin', () => {
  it('accepts exactly six ASCII digits', () => {
    expect(isPin('012345')).toBe(true)
  })

  it.each(['12345', '1234567', '12345a', '123 456', '123-456', ' 123456', '١٢٣٤٥٦', ''])('rejects %j', (value) => {
    expect(isPin(value)).toBe(false)
  })
})

describe('PIN hashes', () => {
  it('verify the PIN they were made from, and no other', async () => {
    const hash = await hashPin('482915')
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/)
    expect(hash).not.toContain('482915')
    await expect(verifyPin('482915', hash)).resolves.toBe(true)
    await expect(verifyPin('482916', hash)).resolves.toBe(false)
  })

  it('use a new salt each time', async () => {
    const first = await hashPin('482915')
    await expect(hashPin('482915')).resolves.not.toBe(first)
  })

  it.each(['', 'bcrypt$1$2$3$a$b', 'scrypt$x$8$1$a$b', 'scrypt$32768$8$1$AAAA$AAAA'])(
    'treat an unreadable hash %j as a wrong PIN',
    async (stored) => {
      await expect(verifyPin('482915', stored)).resolves.toBe(false)
    },
  )
})
