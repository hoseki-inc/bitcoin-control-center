import { expect, it } from 'vitest'
import { featureRouters } from '../../features'
import { authRouter } from '../auth/router'
import { appRouter } from './router'

// New endpoints belong in a feature folder. When a move out of router.ts lowers the count, lower this number with it.
const ROUTER_TS_PROCEDURES = 8

it('adds no endpoint to router.ts', () => {
  const elsewhere = [authRouter, ...Object.values(featureRouters)].reduce(
    (count, child) => count + Object.keys(child._def.procedures).length,
    0,
  )
  expect(Object.keys(appRouter._def.procedures).length - elsewhere).toBe(ROUTER_TS_PROCEDURES)
})
