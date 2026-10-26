import { expect, it } from 'vitest'
import { helpLink, osFamily } from './help-link'

function tags(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams)
}

it('tags a desktop click with the OS family, version, and screen', () => {
  const url = helpLink({ platform: 'desktop', os: 'MacIntel', version: '1.1.0', pathname: '/portfolio' })

  expect(url.startsWith('https://help.hoseki.app/bitcoin-control-center?')).toBe(true)
  expect(tags(url)).toEqual({
    utm_source: 'bitcoin-control-center',
    utm_medium: 'app',
    utm_campaign: 'help-button',
    utm_content: 'desktop-mac',
    utm_term: '1.1.0',
    screen: 'portfolio',
  })
})

it('names server installs by platform alone', () => {
  expect(tags(helpLink({ platform: 'startos', os: 'Win32', version: '1.1.0', pathname: '/home' }))).toMatchObject({
    utm_content: 'startos',
  })
  expect(tags(helpLink({ platform: 'umbrel', os: 'Win32', version: '1.1.0', pathname: '/home' }))).toMatchObject({
    utm_content: 'umbrel',
  })
})

it('keeps only the top-level screen, never IDs further down the path', () => {
  const url = helpLink({ platform: 'web', os: '', version: '1.1.0', pathname: '/accounts/coinbase/abc123' })

  expect(tags(url)['screen']).toBe('accounts')
  expect(url).not.toContain('abc123')
})

it('calls unknown screens "other"', () => {
  for (const pathname of ['/', '/not-a-page', '/my-secret-notes']) {
    expect(tags(helpLink({ platform: 'web', os: '', version: '1.1.0', pathname }))['screen']).toBe('other')
  }
})

it('leaves out the version when the build has none', () => {
  expect(tags(helpLink({ platform: 'web', os: '', version: '', pathname: '/home' }))).not.toHaveProperty('utm_term')
})

it('reduces what the browser reports to an OS family', () => {
  expect(osFamily('macOS')).toBe('mac')
  expect(osFamily('MacIntel')).toBe('mac')
  expect(osFamily('Windows')).toBe('windows')
  expect(osFamily('Win32')).toBe('windows')
  expect(osFamily('Linux x86_64')).toBe('linux')
  expect(osFamily('')).toBe('other')
})
