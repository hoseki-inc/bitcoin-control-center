import type { ComponentType } from 'react'

/** A page a feature adds: its full address inside the app layout, and the screen it shows. */
export type FeatureRoute = { path: string; Component: ComponentType }

const features = import.meta.glob<{ routes?: FeatureRoute[] }>('./*/index.ts', { eager: true })

/** Every feature's pages, read from each feature's index.ts. A new feature folder needs no edit here. */
export const featureRoutes: FeatureRoute[] = Object.entries(features)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([, feature]) => feature.routes ?? [])
