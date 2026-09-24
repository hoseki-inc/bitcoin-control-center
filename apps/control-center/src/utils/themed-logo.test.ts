import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { logoForMode } from './themed-logo'

describe('logoForMode', () => {
  it('keeps every logo as-is in light mode', () => {
    expect(logoForMode('/images/hardware-wallets/trezor.svg', 'light')).toEqual({
      src: '/images/hardware-wallets/trezor.svg',
    })
  })

  it('swaps black vector marks for their white variants in dark mode, including CDN copies', () => {
    expect(logoForMode('/images/hardware-wallets/ledger.svg', 'dark').src).toBe(
      '/images/hardware-wallets/ledger-dark.svg',
    )
    expect(logoForMode('https://assets.example/hardware-wallets/coldcard.svg', 'dark').src).toBe(
      '/images/hardware-wallets/coldcard-dark.svg',
    )
  })

  it('draws monochrome raster marks white and leaves coloured marks alone', () => {
    expect(logoForMode('/images/exchanges/robinhood-lockup.png', 'dark').filter).toBe('brightness(0) invert(1)')
    expect(logoForMode('/images/exchanges/coinbase-wordmark.svg', 'dark')).toEqual({
      src: '/images/exchanges/coinbase-wordmark.svg',
    })
  })

  it('points at dark variants that exist', () => {
    for (const path of ['trezor', 'ledger', 'coldcard', 'keystone-logo']) {
      const { src } = logoForMode(`/images/hardware-wallets/${path}.svg`, 'dark')
      expect(existsSync(resolve(__dirname, '../../public', src.slice(1)))).toBe(true)
    }
    expect(existsSync(resolve(__dirname, '../../public/images/exchanges/strike-logo-dark.svg'))).toBe(true)
  })
})
