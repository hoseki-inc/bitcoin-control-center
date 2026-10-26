import { ChakraProvider } from '@chakra-ui/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { SyncIndicator } from './sync-indicator'

type Props = Parameters<typeof SyncIndicator>[0]

function label(props: Props): string {
  const html = renderToStaticMarkup(createElement(ChakraProvider, null, createElement(SyncIndicator, props)))
  return html
    .replace(/<style[^>]*>.*?<\/style>/gs, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .trim()
}

const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000)

it.each<[string, Props, string]>([
  ['current balances', { wallets: { kind: 'current' } }, 'Synced'],
  ['a balance still loading', { wallets: { kind: 'updating' } }, 'Updating balances'],
  [
    'out-of-date balances whose wallets have all synced',
    { wallets: { kind: 'lastSynced', at: threeHoursAgo } },
    'Last synced 3 hours ago',
  ],
  [
    'a wallet that has never synced and cannot be scanned',
    { wallets: { kind: 'unreachable' } },
    "Can't reach Electrum",
  ],
  ['history still syncing', { wallets: { kind: 'current' }, historySyncingCount: 1 }, 'Updating history'],
  ['history that failed', { wallets: { kind: 'current' }, hasError: true }, 'History unavailable'],
  [
    'out-of-date balances alongside a history failure',
    { wallets: { kind: 'lastSynced', at: threeHoursAgo }, hasError: true },
    'Last synced 3 hours ago',
  ],
  [
    'a wallet that cannot be reached alongside a history failure',
    { wallets: { kind: 'unreachable' }, hasError: true },
    "Can't reach Electrum",
  ],
  ['account lists that failed to load', { wallets: null }, ''],
])('says the right thing for %s', (_case, props, expected) => {
  // "Last synced" is followed by the exact time, for screen readers.
  expect(label(props).slice(0, expected.length || undefined)).toBe(expected)
})

it('announces a wallet it cannot reach even beside a history error, and keeps only "History unavailable" quiet', () => {
  const output = (props: Props): string =>
    /<output[^>]*>/.exec(
      renderToStaticMarkup(createElement(ChakraProvider, null, createElement(SyncIndicator, props))),
    )?.[0] ?? ''
  const unreachable = output({ wallets: { kind: 'unreachable' }, hasError: true })
  expect(unreachable).toMatch(/^<output/)
  expect(unreachable).not.toContain('aria-live="off"')
  expect(output({ wallets: { kind: 'current' }, hasError: true })).toContain('aria-live="off"')
})
