import * as fs from 'node:fs'
import * as path from 'node:path'
import { DATA_FOLDER_NAME, DEVELOPMENT_DATA_FOLDER_NAME } from './app-identity'

export const VERIFY_CONFIG_ENV = 'BCC_VERIFY_CONFIG'

export interface DesktopVerifyElectrumConfig {
  host: '127.0.0.1'
  port: number
  protocol: 'tcp'
}

export interface DesktopVerifyConfig {
  userDataDir: string
  electrum: DesktopVerifyElectrumConfig
  mempoolApiUrl: string
  disableReleaseCheck: boolean
  releaseCheckUrl?: string
  downloadsDir?: string
}

interface RawVerifyElectrum {
  host?: unknown
  port?: unknown
  protocol?: unknown
}

interface RawVerifyConfig {
  userDataDir?: unknown
  electrum?: unknown
  mempoolApiUrl?: unknown
  disableReleaseCheck?: unknown
  releaseCheckUrl?: unknown
  downloadsDir?: unknown
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON.parse produces unknown and is validated structurally here.
function isRawObject(value: unknown): value is RawVerifyConfig {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Nested JSON config field validated structurally here.
function isRawElectrum(value: unknown): value is RawVerifyElectrum {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON property validated structurally here.
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON property validated structurally here.
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON property validated structurally here.
function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535
}

/**
 * Resolves symlinks on the deepest existing ancestor of `targetPath` and rejoins any
 * not-yet-created suffix segments, so path containment checks cannot be bypassed via symlinks.
 */
export function canonicalizePath(targetPath: string): string {
  let current = path.resolve(targetPath)
  const suffix: string[] = []
  for (;;) {
    try {
      const real = fs.realpathSync.native(current)
      return suffix.length > 0 ? path.join(real, ...suffix.reverse()) : real
    } catch {
      const parent = path.dirname(current)
      if (parent === current) {
        return suffix.length > 0 ? path.join(current, ...suffix.reverse()) : current
      }
      suffix.push(path.basename(current))
      current = parent
    }
  }
}

function normalizeForCompare(value: string, platform: NodeJS.Platform): string {
  return platform === 'darwin' || platform === 'win32' ? value.toLowerCase() : value
}

function isInsideOrEqual(parentDir: string, candidateDir: string, platform: NodeJS.Platform): boolean {
  const relative = path.relative(normalizeForCompare(parentDir, platform), normalizeForCompare(candidateDir, platform))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function assertIsolatedScratchDir(
  fieldName: string,
  rawPath: string,
  canonicalAppData: string,
  canonicalConfigDir: string,
  platform: NodeJS.Platform,
): string {
  if (!path.isAbsolute(rawPath)) {
    throw new Error(`Verify config ${fieldName} must be an absolute path`)
  }
  const canonicalTarget = canonicalizePath(rawPath)
  if (isInsideOrEqual(canonicalAppData, canonicalTarget, platform)) {
    throw new Error(`Verify config ${fieldName} must lie outside appData`)
  }
  if (!isInsideOrEqual(canonicalConfigDir, canonicalTarget, platform)) {
    throw new Error(`Verify config ${fieldName} must lie inside the verify config directory`)
  }
  const forbiddenNames = new Set([
    normalizeForCompare(DATA_FOLDER_NAME, platform),
    normalizeForCompare(DEVELOPMENT_DATA_FOLDER_NAME, platform),
  ])
  for (const name of [path.basename(path.resolve(rawPath)), path.basename(canonicalTarget)]) {
    if (forbiddenNames.has(normalizeForCompare(name, platform))) {
      throw new Error(`Verify config ${fieldName} cannot use the desktop data folder name "${name}"`)
    }
  }
  return canonicalTarget
}

function assertLoopbackHttpUrl(fieldName: string, rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Verify config ${fieldName} is not a valid URL`)
  }
  const port = Number(parsed.port)
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(`Verify config ${fieldName} must be an http://127.0.0.1:<port> URL`)
  }
  return parsed.toString().replace(/\/$/, '')
}

export function parseDesktopVerifyConfig(
  rawJson: string,
  appDataDir: string,
  configDir: string,
  platform: NodeJS.Platform = process.platform,
): DesktopVerifyConfig {
  let decoded: unknown
  try {
    decoded = JSON.parse(rawJson)
  } catch {
    throw new Error('Verify config file does not contain valid JSON')
  }
  if (!isRawObject(decoded)) {
    throw new Error('Verify config must be a JSON object')
  }

  const canonicalAppData = canonicalizePath(appDataDir)
  const canonicalConfigDir = canonicalizePath(configDir)
  if (!isNonEmptyString(decoded.userDataDir)) {
    throw new Error('Verify config requires a non-empty userDataDir')
  }
  const userDataDir = assertIsolatedScratchDir(
    'userDataDir',
    decoded.userDataDir,
    canonicalAppData,
    canonicalConfigDir,
    platform,
  )

  if (!isRawElectrum(decoded.electrum)) {
    throw new Error('Verify config requires an electrum object')
  }
  if (decoded.electrum.host !== '127.0.0.1') {
    throw new Error('Verify config electrum.host must be 127.0.0.1')
  }
  if (!isValidPort(decoded.electrum.port)) {
    throw new Error('Verify config electrum.port must be a valid TCP port')
  }
  if (decoded.electrum.protocol !== 'tcp') {
    throw new Error('Verify config electrum.protocol must be tcp')
  }

  if (!isNonEmptyString(decoded.mempoolApiUrl)) {
    throw new Error('Verify config requires mempoolApiUrl')
  }
  const mempoolApiUrl = assertLoopbackHttpUrl('mempoolApiUrl', decoded.mempoolApiUrl)

  if (!isBoolean(decoded.disableReleaseCheck)) {
    throw new Error('Verify config requires boolean disableReleaseCheck')
  }

  const config: DesktopVerifyConfig = {
    userDataDir,
    electrum: {
      host: '127.0.0.1',
      port: decoded.electrum.port,
      protocol: 'tcp',
    },
    mempoolApiUrl,
    disableReleaseCheck: decoded.disableReleaseCheck,
  }

  if (decoded.releaseCheckUrl !== undefined) {
    if (!isNonEmptyString(decoded.releaseCheckUrl)) {
      throw new Error('Verify config releaseCheckUrl must be a non-empty URL string')
    }
    config.releaseCheckUrl = assertLoopbackHttpUrl('releaseCheckUrl', decoded.releaseCheckUrl)
  }

  if (!decoded.disableReleaseCheck && config.releaseCheckUrl === undefined) {
    throw new Error('Verify config requires releaseCheckUrl when disableReleaseCheck is false')
  }

  if (decoded.downloadsDir !== undefined) {
    if (!isNonEmptyString(decoded.downloadsDir)) {
      throw new Error('Verify config downloadsDir must be a non-empty absolute path')
    }
    config.downloadsDir = assertIsolatedScratchDir(
      'downloadsDir',
      decoded.downloadsDir,
      canonicalAppData,
      canonicalConfigDir,
      platform,
    )
  }

  return config
}

export function loadDesktopVerifyConfig(
  configPath: string | undefined,
  appDataDir: string,
  platform: NodeJS.Platform = process.platform,
): DesktopVerifyConfig | null {
  if (configPath === undefined || configPath.trim() === '') {
    return null
  }
  const resolvedConfigPath = path.resolve(configPath)
  const raw = fs.readFileSync(resolvedConfigPath, 'utf8')
  return parseDesktopVerifyConfig(raw, appDataDir, path.dirname(resolvedConfigPath), platform)
}
