import { z } from 'zod'
import { STATUSES, earlierOutcomes, latestRecorded } from './rules'
import { type BundleProvenance, BundleProvenanceSchema, type RunState } from './run'

// The pure part of `helpers/verify evidence`: what evidence.json holds and how report.md reads. evidence.ts does the
// files and the command line.

export const RecordSchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  /** The checkout's commit at launch: the helpers and recipes that ran. An --electron bundle's own is in `bundle`. */
  commit: z.string(),
  tree: z.string(),
  dirty: z.boolean(),
  /** `unseeded`: a --setup-pin-in-ui run whose evidence started before the seed. */
  baseline: z.enum(['seeded', 'fresh', 'unseeded']),
  /** Which app the run served: standalone web, --desktop without Electron, or packaged Electron (--electron). */
  app: z.enum(['standalone', 'desktop', 'electron-packaged']).default('standalone'),
  /** PIN mode: false (off), true/'umbrel' (Umbrel rules), or 'desktop' (Electron desktop PIN). */
  pins: z.union([z.boolean(), z.enum(['umbrel', 'desktop'])]).default(false),
  setupPinInUi: z.boolean().default(false),
  releaseTag: z.string().nullable().default(null),
  bundle: BundleProvenanceSchema.nullable().default(null),
  url: z.string(),
  versions: z.record(z.string(), z.string()),
  attempts: z.array(
    z.object({
      /** A recipe ID names folders, so it is letters, digits, - and _ only, as `checkId` requires. */
      recipe: z.string().regex(/^[\w-]+$/),
      number: z.number().int().positive(),
      feature: z.string(),
      proves: z.array(z.string()),
      begunAt: z.string(),
      sentinelStartedAt: z.string(),
      abandonedAt: z.string().nullable(),
      outcome: z
        .object({
          status: z.enum(STATUSES),
          reason: z.string().nullable(),
          recordedAt: z.string(),
          artifacts: z.array(z.string()),
        })
        .nullable(),
    }),
  ),
})
export type EvidenceRecord = z.infer<typeof RecordSchema>

export const LABELS: Record<(typeof STATUSES)[number], string> = {
  verified: 'Verified',
  failed: 'Failed',
  unreachable: 'Verified-unreachable',
}

type StartState = Pick<RunState, 'runId' | 'fresh' | 'setupPinInUi'>

/** The run's data when evidence starts. Only a --setup-pin-in-ui run may start before its seed. */
export function baselineOf(state: StartState, seeded: boolean): EvidenceRecord['baseline'] {
  if (state.fresh) {
    return 'fresh'
  }
  return seeded || !state.setupPinInUi ? 'seeded' : 'unseeded'
}

/** Why `evidence start` must refuse this run, or null. */
export function startProblem(
  state: StartState,
  found: { seeded: boolean; smokeReport: boolean },
  helper: string,
): string | null {
  if (found.smokeReport) {
    // Smoke's report.md would be overwritten, and smoke has already changed the run's data.
    return `Run ${state.runId} holds a smoke report (smoke.json). Launch a new run ID for recipes.`
  }
  if (!state.fresh && !state.setupPinInUi && !found.seeded) {
    return `Run ${state.runId} is not seeded. Run ${helper} seed first, or launch with --fresh.`
  }
  return null
}

/** A new evidence record for a live run, with no attempts. */
export function newRecord(
  state: RunState,
  found: { seeded: boolean; startedAt: string; versions: Record<string, string> },
): EvidenceRecord {
  return {
    runId: state.runId,
    startedAt: found.startedAt,
    commit: state.build.commit,
    tree: state.build.tree,
    dirty: state.build.dirty,
    baseline: baselineOf(state, found.seeded),
    app: state.electron ? 'electron-packaged' : state.desktop ? 'desktop' : 'standalone',
    pins: state.electron ? 'desktop' : state.pin ? 'umbrel' : false,
    setupPinInUi: state.setupPinInUi,
    releaseTag: state.releaseTag ?? null,
    bundle: state.bundle ?? null,
    url: state.url,
    versions: found.versions,
    attempts: [],
  }
}

/** A CDP `/json/version` answer, the parts the report uses. */
export const CdpVersionSchema = z.object({
  Browser: z.string().optional(),
  'User-Agent': z.string().optional(),
})
export type CdpVersion = z.infer<typeof CdpVersionSchema>

export interface RuntimeVersions {
  Electron?: string
  Chromium?: string
}

/** Electron's version from the user agent and Chromium's from Browser; either is left out when missing. */
export function cdpVersions(answer: CdpVersion): RuntimeVersions {
  const versions: RuntimeVersions = {}
  const electron = /Electron\/([\d.]+)/.exec(answer['User-Agent'] ?? '')?.[1]
  if (electron !== undefined) {
    versions.Electron = electron
  }
  if (answer.Browser !== undefined) {
    versions.Chromium = answer.Browser.replace(/^Chrome\//, '')
  }
  return versions
}

/** Where an --electron run's app came from and what it was built from, flagging a commit other than the checkout's. */
export function describeBundle(bundle: BundleProvenance, checkoutCommit: string): string {
  const origin = bundle.origin === 'app' ? `--app ${bundle.source}` : 'built from this checkout at launch'
  if (bundle.commit === null) {
    return `${origin}, no build stamp in the bundle`
  }
  const release = bundle.release === null ? '' : `, release ${bundle.release}`
  const dirty = bundle.dirty === true ? ' with uncommitted changes' : ''
  const other = bundle.commit === checkoutCommit ? '' : `. Not the checkout's commit ${checkoutCommit}`
  return `${origin}, commit ${bundle.commit}${dirty}${release}${other}`
}

const BASELINES: Record<EvidenceRecord['baseline'], string> = {
  seeded: 'seeded',
  fresh: 'fresh run, not seeded',
  unseeded: 'not seeded when evidence started (launch --setup-pin-in-ui)',
}

function appLabel(app: EvidenceRecord['app']): string {
  switch (app) {
    case 'electron-packaged':
      return 'packaged macOS Electron app (launch --electron)'
    case 'desktop':
      return 'desktop (launch --desktop, no Electron shell)'
    case 'standalone':
      return 'standalone web app'
  }
}

function pinsLabel(record: EvidenceRecord): string {
  if (record.pins === 'desktop') {
    return `on, desktop rules (launch --electron${record.setupPinInUi ? ' --setup-pin-in-ui: PIN set in the UI' : ''})`
  }
  if (record.pins === 'umbrel' || record.pins) {
    return 'on, Umbrel rules (launch --pin)'
  }
  return 'off'
}

export function report(record: EvidenceRecord): string {
  const lines = [
    `# Verification report: ${record.runId}`,
    '',
    `- Commit: ${record.commit}${record.dirty ? ` with uncommitted changes (tree ${record.tree})` : ''}`,
    `- Baseline: ${BASELINES[record.baseline]}`,
    `- App: ${appLabel(record.app)}`,
    ...(record.bundle === null ? [] : [`- App bundle: ${describeBundle(record.bundle, record.commit)}`]),
    `- PINs: ${pinsLabel(record)}`,
    ...(record.releaseTag === null ? [] : [`- Release tag served: ${record.releaseTag}`]),
    `- Started: ${record.startedAt}`,
    `- Versions: ${Object.entries(record.versions)
      .map(([name, version]) => `${name} ${version}`)
      .join(', ')}`,
    '',
  ]
  const shown = latestRecorded(record.attempts)
  if (shown.length === 0) {
    lines.push('No recipes recorded yet.')
  }
  for (const attempt of shown) {
    const { outcome } = attempt
    const earlier = earlierOutcomes(record.attempts, attempt)
    // A pass after a failed first attempt is a flake until the cause is known: the report never hides it.
    const retried = outcome.status === 'verified' && earlier.some((item) => item.status !== 'verified')
    lines.push(
      `## ${attempt.recipe}: ${LABELS[outcome.status]}${retried ? ' on retry (flaky)' : ''}`,
      '',
      `Feature: ${attempt.feature}, attempt ${attempt.number}`,
      '',
      `${outcome.status === 'verified' ? 'Proves' : 'Would prove'}: ${attempt.proves.join(', ')}`,
      '',
    )
    if (outcome.reason !== null) {
      lines.push(
        outcome.status === 'unreachable' ? `Missing precondition: ${outcome.reason}` : `Reason: ${outcome.reason}`,
        '',
      )
    }
    for (const item of earlier) {
      lines.push(`Earlier attempt: ${LABELS[item.status]}${item.reason === null ? '' : `, ${item.reason}`}.`, '')
    }
    lines.push(`Recorded ${outcome.recordedAt}.`, '')
    if (outcome.artifacts.length > 0) {
      lines.push('Artifacts:', '', ...outcome.artifacts.map((file) => `- [${file}](${file})`), '')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}
