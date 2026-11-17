import type { ReactElement, ReactNode } from 'react'
import { type RouteObject, createRoutesFromChildren, matchRoutes } from 'react-router'
import { routes as etfRoutes } from './features/etf'
import AppRoutes from './routes'

function appRoutes(): RouteObject[] {
  // SAFETY: AppRoutes returns <RenderErrorBoundary><Routes>…</Routes></RenderErrorBoundary>, so the
  // Routes element is the boundary's only child; a different shape fails the page list below.
  const boundary = AppRoutes() as ReactElement<{ children: ReactElement<{ children: ReactNode }> }>
  return createRoutesFromChildren(boundary.props.children.props.children)
}

/** The full address of every page, in the order the app declares them. */
function pageAddresses(routes: RouteObject[], parent = ''): string[] {
  return routes.flatMap((route) => {
    const path = route.path === undefined || route.path === '' ? parent : `${parent}/${route.path.replace(/^\//, '')}`
    if (route.children === undefined) {
      return [path === '' ? '/' : path]
    }
    return pageAddresses(route.children, path)
  })
}

it('serves every page at the address it had before features listed their own pages', () => {
  expect(pageAddresses(appRoutes())).toEqual([
    '/',
    '/portfolio',
    '/home',
    '/accounts',
    '/accounts/add',
    '/accounts/coinbase/:accountId',
    '/accounts/kraken/:accountId',
    '/accounts/robinhood/:accountId',
    '/accounts/strike/:accountId',
    '/accounts/manual/:accountId',
    '/accounts/:claimId',
    '/accounts/:claimId/signing',
    '/accounts/verify/trezor',
    '/accounts/verify/ledger',
    '/accounts/verify/coldcard',
    '/accounts/verify/keystone',
    '/accounts/verify/bitkey',
    '/accounts/verify/advanced',
    '/accounts/verify/coinbase',
    '/accounts/verify/kraken',
    '/accounts/verify/robinhood',
    '/accounts/verify/strike',
    '/accounts/verify/manual-type',
    '/accounts/verify/manual',
    '/accounts/verify/track',
    '/accounts/etf/:accountId',
    '/accounts/verify/etf',
    '/statements',
    '/statements/create',
    '/settings',
    '/accounts/verify/receipt/:claimId',
    '/multisig/verify/receipt/:claimId/:keystoreId',
    '/multisig',
    '/multisig/create',
    '/multisig/:claimId',
    '/multisig/:claimId/connect/:walletType/:keystoreId',
    '/multisig/:claimId/signing/:walletType/:keystoreId',
    '/statements/:statementId',
    '/test/hardware-wallets',
    '/*',
  ])
})

it('gives every page its own address', () => {
  const addresses = pageAddresses(appRoutes())
  expect(addresses.filter((address, index) => addresses.indexOf(address) !== index)).toEqual([])
})

it.each(etfRoutes)('opens the ETF screen at $path', ({ path, Component }) => {
  const address = `/${path.replace(':accountId', 'etf-account-1')}`
  expect(matchRoutes(appRoutes(), address)?.at(-1)?.route.Component).toBe(Component)
})
