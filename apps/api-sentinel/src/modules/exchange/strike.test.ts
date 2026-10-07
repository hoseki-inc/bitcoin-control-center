import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { getStrikeBtcBalance, validateStrikeApiKey } from './strike'

const logger = pino({ level: 'silent' })
const balances = [{ currency: 'BTC', total: '1.25', available: '1.25' }]

describe.each([
  { name: 'BTC balance', run: getStrikeBtcBalance },
  { name: 'API key validation', run: validateStrikeApiKey },
])('Strike $name', ({ run }) => {
  it('propagates network errors as Err, not a rejected Panic', async () => {
    const error = new Error('Synthetic connection failure')
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(error)
    onTestFinished(() => {
      fetch.mockRestore()
    })

    await expect(run('synthetic-api-key', logger).expectErr('Expected network failure')).resolves.toBe(error)
  })

  it('propagates invalid JSON as Err, not a rejected Panic', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid JSON'))
    onTestFinished(() => {
      fetch.mockRestore()
    })

    await expect(run('synthetic-api-key', logger).expectErr('Expected JSON failure')).resolves.toBeInstanceOf(
      SyntaxError,
    )
  })

  it('retains the response validation error message', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ invalid: true }))
    onTestFinished(() => {
      fetch.mockRestore()
    })

    const error = await run('synthetic-api-key', logger).expectErr('Expected validation failure')
    expect(error.message).toContain('Invalid Strike API response:')
  })
})

it('returns the BTC balance in satoshis', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(balances))
  onTestFinished(() => {
    fetch.mockRestore()
  })

  await expect(getStrikeBtcBalance('synthetic-api-key', logger).expect('Expected balance')).resolves.toBe(125_000_000n)
})

it('returns validated balances', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(balances))
  onTestFinished(() => {
    fetch.mockRestore()
  })

  await expect(validateStrikeApiKey('synthetic-api-key', logger).expect('Expected balances')).resolves.toEqual(balances)
})
