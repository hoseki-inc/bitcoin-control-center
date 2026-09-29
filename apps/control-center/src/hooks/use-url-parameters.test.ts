// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { setupDetailsRoute } from '../testing/details-route.fixtures'

describe.each([
  '/accounts/foo',
  '/accounts/foo/signing',
  '/accounts/verify/receipt/foo',
  '/statements/foo',
  '/multisig/foo',
  '/multisig/verify/receipt/foo/key',
])('invalid ID URL %s', (path) => {
  it.each(['direct', 'navigation'] as const)('shows a recoverable error on %s entry', async (entry) => {
    const { container, open, goHome, requests } = await setupDetailsRoute(path, entry)

    await expect(open()).resolves.toBeUndefined()

    expect(container.textContent).toMatch(/invalid|not found|error/i)
    expect(requests).toEqual([])

    await goHome()

    expect(container.textContent).toContain('Home page')
  })
})

describe('well-formed details URLs for missing records', () => {
  it.each([
    { path: '/accounts/re_clmx_missing', input: { id: 're_clmx_missing' } },
    { path: '/statements/st_stmt_missing', input: 'st_stmt_missing' },
  ])('displays the server error for $path without crashing', async ({ path, input }) => {
    const { container, open, goHome, requests } = await setupDetailsRoute(path, 'direct')

    await open()

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/not found/i)
    })
    expect(requests.map((request) => request.input)).toEqual([input])

    await goHome()

    expect(container.textContent).toContain('Home page')
  })
})
