import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { type Browser, type Page, chromium } from 'playwright-core'
import { z } from 'zod'
import { readArgs } from './args'
import { VERIFY_PIN, sentinelClient, signIn } from './client'
import { extractPdfText, pdfTextIncludes } from './pdf-text'
import { ChildEnv, runAsync, verifyHelperEnv } from './process'
import { type TorMode, classifyTorOutcome } from './rules'
import {
  EVIDENCE_ROOT,
  HELPER,
  REPO_ROOT,
  type RunState,
  fail,
  isOurProcess,
  listeners,
  newRunId,
  processGroupPids,
  quitProcessCleanly,
  readRunState,
  requireJsonFile,
  runPaths,
  verifyCapableBundleProblem,
  wait,
} from './run'
import {
  type DirSnapshot,
  type StepResult,
  type StepStatus,
  computeSmokeVerdict,
  findMainProcessErrors,
  matchesAnyPortfolioUsdQuote,
  parseLsofOpenFiles,
  parseScopedUsdAmount,
  parseVerifyDownloadEvent,
  smokeRunProblem,
  snapshotDir,
  verifyCleanShutdownLog,
  verifyFolderUntouched,
  waitForCondition,
  waitForValue,
} from './smoke-helpers'

const VERIFY_BIN = join(REPO_ROOT, HELPER)
const LAUNCH_TIMEOUT_MS = 15 * 60_000
const HELPER_TIMEOUT_MS = 180_000
const UI_TIMEOUT_MS = 30_000
const TOR_ONLINE_TIMEOUT_MS = 120_000
const TOR_OFFLINE_WAIT_AFTER_SOCKS_MS = 30_000
const SEEDED_TOTAL_BTC = 1.79999
const SEEDED_ACCOUNT_COUNT = 3

const DesktopBridgeSchema = z.object({
  platform: z.string().nullable(),
  hasOnLock: z.boolean(),
  hasLedger: z.boolean(),
})

const CdpVersionSchema = z.object({
  Browser: z.string().optional(),
  'User-Agent': z.string().optional(),
})

const CdpTargetListSchema = z.array(z.object({ type: z.string(), url: z.string() }))

const MempoolPriceSchema = z.object({
  USD: z.number().positive(),
})

const QueryRowsSchema = z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))

const { values } = readArgs({
  run: { type: 'string' },
  app: { type: 'string' },
  'tor-mode': { type: 'string' },
  keep: { type: 'boolean' },
})

if (process.platform !== 'darwin') {
  fail('helpers/verify smoke currently supports macOS (darwin) only.')
}

const torModeRaw = values['tor-mode'] ?? 'online'
if (torModeRaw !== 'online' && torModeRaw !== 'allow-offline') {
  fail(`Invalid --tor-mode "${torModeRaw}". Use "online" or "allow-offline".`)
}
const torMode: TorMode = torModeRaw
const runId = values.run ?? newRunId()
const appPath = values.app === undefined ? undefined : resolve(values.app)
const keep = values.keep === true

const paths = runPaths(runId)
const evidenceDir = join(EVIDENCE_ROOT, runId)

const existingRunProblem = smokeRunProblem({
  runId,
  runDirExists: existsSync(paths.runDir),
  evidenceDirExists: existsSync(evidenceDir),
})
if (existingRunProblem !== null) {
  fail(existingRunProblem)
}

function readLogSlice(filePath: string, offset: number): string {
  if (!existsSync(filePath)) {
    return ''
  }
  return readFileSync(filePath, 'utf8').slice(offset)
}

async function openFilesInDirs(leaderPid: number, dirs: string[]): Promise<string[]> {
  const pids = processGroupPids(leaderPid)
  if (pids.length === 0) {
    throw new Error(`No live processes found in Electron process group ${leaderPid} for open-file check`)
  }
  const result = await runAsync('lsof', ['-n', '-P', '-Fn', '-p', pids.join(',')], {
    env: ChildEnv.with(),
    timeoutMs: 15_000,
  })
  return parseLsofOpenFiles(result, dirs)
}

async function runHelper(args: string[], timeoutMs = HELPER_TIMEOUT_MS): Promise<{ ok: boolean; output: string }> {
  const result = await runAsync(VERIFY_BIN, args, {
    cwd: REPO_ROOT,
    env: verifyHelperEnv(),
    timeoutMs,
  })
  const output = [result.stdout.trim(), result.stderr.trim()].filter((part) => part.length > 0).join('\n')
  return { ok: !result.timedOut && result.code === 0, output }
}

async function runSqlQuery(sql: string): Promise<Array<Record<string, string | number | boolean | null>>> {
  const res = await runHelper(['query', '--run', runId, '--sql', sql])
  if (!res.ok) {
    throw new Error(`helpers/verify query failed: ${res.output}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(res.output)
  } catch {
    throw new Error(`helpers/verify query returned non-JSON: ${res.output.slice(0, 300)}`)
  }
  const parsed = parseUnknown(QueryRowsSchema, raw)
  if (parsed.isErr()) {
    throw new Error(`helpers/verify query returned unexpected shape: ${res.output.slice(0, 300)}`)
  }
  return parsed.unwrap()
}

interface VersionMap {
  Node: string
  Electron?: string
  Chromium?: string
}

async function readVersions(cdpPort: number): Promise<VersionMap> {
  const versions: VersionMap = { Node: process.version }
  try {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
    if (res.ok) {
      const parsed = parseUnknown(CdpVersionSchema, await res.json())
      if (parsed.isOk()) {
        const ua = parsed.unwrap()['User-Agent'] ?? ''
        const electronMatch = /Electron\/([\d.]+)/.exec(ua)
        if (electronMatch?.[1] !== undefined) {
          versions.Electron = electronMatch[1]
        }
        const browser = parsed.unwrap().Browser
        if (browser !== undefined) {
          versions.Chromium = browser.replace(/^Chrome\//, '')
        }
      }
    }
  } catch {
    return versions
  }
  return versions
}

async function countCdpPageTargets(cdpPort: number): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
  if (!res.ok) {
    return -1
  }
  const parsed = parseUnknown(CdpTargetListSchema, await res.json())
  return parsed.isOk() ? parsed.unwrap().filter((target) => target.type === 'page').length : -1
}

async function fetchFakeUsdPrice(mempoolPort: number): Promise<number> {
  const priceRes = await fetch(`http://127.0.0.1:${mempoolPort}/api/v1/prices`)
  if (!priceRes.ok) {
    throw new Error(`Fake mempool /api/v1/prices failed with HTTP ${priceRes.status}`)
  }
  const parsedPrice = parseUnknown(MempoolPriceSchema, await priceRes.json())
  if (parsedPrice.isErr()) {
    throw new Error('Fake mempool /api/v1/prices returned unexpected shape')
  }
  return parsedPrice.unwrap().USD
}

async function waitForPinInputReady(page: Page, ariaLabel: string): Promise<void> {
  const input = page.locator(`input[aria-label="${ariaLabel}"]`)
  await input.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
  const deadline = Date.now() + UI_TIMEOUT_MS
  while (Date.now() < deadline) {
    const disabled = await input.isDisabled()
    const current = await input.inputValue()
    if (!disabled && current === '') {
      return
    }
    await wait(150)
  }
  throw new Error(`PIN input "${ariaLabel}" did not become ready and empty`)
}

async function enterPin(page: Page, ariaLabel: string, pin: string): Promise<void> {
  await waitForPinInputReady(page, ariaLabel)
  const input = page.locator(`input[aria-label="${ariaLabel}"]`)
  await input.click()
  await input.fill('')
  await input.pressSequentially(pin, { delay: 30 })
}

async function unlockIfLocked(page: Page): Promise<void> {
  const enterHeading = page.getByText('Enter your PIN', { exact: true })
  if (await enterHeading.isVisible().catch(() => false)) {
    await enterPin(page, 'PIN, 6 digits', VERIFY_PIN)
    await enterHeading.waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
  }
}

const appSupportDir = join(homedir(), 'Library', 'Application Support')
const electronLogPath = join(paths.logsDir, 'electron.log')

const steps: StepResult[] = []
const traceLines: string[] = [
  `# Electron smoke trace: ${runId}`,
  '',
  `- Started: ${new Date().toISOString()}`,
  `- Tor mode: ${torMode}`,
  `- App override: ${appPath ?? '(built via desktop/build.sh --mac-dir)'}`,
  '',
]
const pageErrors: string[] = []
const consoleErrors: string[] = []
const externalRequests: string[] = []
const mainProcessErrors: string[] = []
const screenshots: string[] = []

async function runStep(
  name: string,
  fn: () => Promise<{ status?: StepStatus; detail: string; screenshot?: string }>,
): Promise<boolean> {
  const start = Date.now()
  traceLines.push(`## ${name}`)
  try {
    const result = await fn()
    const status: StepStatus = result.status ?? 'pass'
    const durationMs = Date.now() - start
    const entry: StepResult = { name, status, detail: result.detail, durationMs }
    if (result.screenshot !== undefined) {
      entry.screenshot = result.screenshot
    }
    steps.push(entry)
    traceLines.push(`- Status: ${status} (${durationMs}ms)`, `- Detail: ${result.detail}`)
    if (result.screenshot !== undefined) {
      traceLines.push(`- Screenshot: [${result.screenshot}](${result.screenshot})`)
    }
    traceLines.push('')
    console.log(`${status.toUpperCase().padEnd(18)} ${name} — ${result.detail}`)
    return status !== 'fail'
  } catch (error) {
    const durationMs = Date.now() - start
    const message = error instanceof Error ? error.message : String(error)
    steps.push({ name, status: 'fail', detail: message, durationMs })
    traceLines.push(`- Status: fail (${durationMs}ms)`, `- Error: ${message}`, '')
    console.error(`FAIL               ${name} — ${message}`)
    return false
  }
}

async function capture(page: Page, filename: string): Promise<string> {
  const fullPath = join(evidenceDir, filename)
  await page.screenshot({ path: fullPath })
  screenshots.push(filename)
  return filename
}

interface SmokeContext {
  state: RunState | null
  browser: Browser | null
  versions: VersionMap
  launched: boolean
  cleanedUp: boolean
  orchestrationError: string | null
  beforeDesktopSnapshot: DirSnapshot | null
  beforeDesktopDevSnapshot: DirSnapshot | null
}

const ctx: SmokeContext = {
  state: null,
  browser: null,
  versions: { Node: process.version },
  launched: false,
  cleanedUp: false,
  orchestrationError: null,
  beforeDesktopSnapshot: null,
  beforeDesktopDevSnapshot: null,
}

try {
  ctx.beforeDesktopSnapshot = snapshotDir(join(appSupportDir, 'desktop'))
  ctx.beforeDesktopDevSnapshot = snapshotDir(join(appSupportDir, 'desktop-dev'))

  const launchArgs = ['launch', '--electron', '--setup-pin-in-ui', '--run', runId]
  if (appPath !== undefined) {
    launchArgs.push('--app', appPath)
  }
  const launchOk = await runStep('launch', async () => {
    const res = await runHelper(launchArgs, LAUNCH_TIMEOUT_MS)
    if (!res.ok) {
      throw new Error(`launch --electron failed:\n${res.output}`)
    }
    ctx.launched = true
    const loaded = requireJsonFile(readRunState(paths))
    if (
      loaded === null ||
      !loaded.electron ||
      loaded.cdpPort === undefined ||
      loaded.userDataDir === undefined ||
      loaded.dataDir === undefined ||
      loaded.downloadsDir === undefined ||
      loaded.appBundle === undefined
    ) {
      throw new Error('run.json is missing required Electron metadata after launch')
    }
    ctx.state = loaded
    ctx.versions = await readVersions(loaded.cdpPort)
    return { detail: `launched ${loaded.appBundle} on ${loaded.url} (CDP ${loaded.cdpPort})` }
  })

  if (launchOk && ctx.state !== null) {
    mkdirSync(evidenceDir, { recursive: true })
    const runState: RunState = ctx.state
    const cdpPort = runState.cdpPort ?? fail('Missing cdpPort')
    const userDataDir = runState.userDataDir ?? fail('Missing userDataDir')
    const downloadsDir = runState.downloadsDir ?? fail('Missing downloadsDir')
    const appBundle = runState.appBundle ?? fail('Missing appBundle')
    const electronBin = join(appBundle, 'Contents/MacOS/Bitcoin Control Center')
    const verifyConfigFile = join(paths.runDir, 'verify-config.json')

    ctx.browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { noDefaults: true })
    const contexts = ctx.browser.contexts()
    const pages = contexts.flatMap((context) => context.pages())
    const mainPage = pages.find((candidate) => candidate.url().startsWith(runState.url))
    if (mainPage === undefined) {
      throw new Error(`Could not locate Electron BrowserWindow page for ${runState.url} (found ${pages.length} pages)`)
    }
    const page: Page = mainPage

    const CHROMIUM_PDF_VIEWER_PREFIX = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'
    const attachedPages = new WeakSet<Page>()
    const attachPage = (targetPage: Page): void => {
      if (attachedPages.has(targetPage)) {
        return
      }
      attachedPages.add(targetPage)
      targetPage.on('pageerror', (error) => {
        pageErrors.push(error.message)
      })
      targetPage.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text())
        }
      })
    }
    for (const context of contexts) {
      context.on('request', (request) => {
        const reqUrl = request.url()
        if (
          reqUrl.startsWith(runState.url) ||
          reqUrl.startsWith('data:') ||
          reqUrl.startsWith('blob:') ||
          reqUrl.startsWith('about:') ||
          reqUrl.startsWith('chrome://') ||
          reqUrl.startsWith(CHROMIUM_PDF_VIEWER_PREFIX)
        ) {
          return
        }
        externalRequests.push(`${request.method()} ${reqUrl}`)
      })
      context.on('page', attachPage)
      for (const existingPage of context.pages()) {
        attachPage(existingPage)
      }
    }
    await page.reload({ waitUntil: 'domcontentloaded' })

    const client = sentinelClient(runState.url)

    const check1Ok = await runStep('1. Launch, preload bridge & PIN setup', async () => {
      if (pages.length !== 1) {
        throw new Error(`Expected exactly 1 Electron BrowserWindow page, found ${pages.length}`)
      }
      const bridgeRaw: unknown = await page.evaluate(
        '({ platform: window.desktop?.platform ?? null, hasOnLock: typeof window.desktop?.pin?.onLock === "function", hasLedger: typeof window.desktop?.ledger?.begin === "function" })',
      )
      const bridgeParsed = parseUnknown(DesktopBridgeSchema, bridgeRaw)
      if (bridgeParsed.isErr()) {
        throw new Error('window.desktop preload bridge returned unexpected shape')
      }
      const bridge = bridgeParsed.unwrap()
      if (bridge.platform !== 'darwin' || !bridge.hasOnLock || !bridge.hasLedger) {
        throw new Error(
          `window.desktop preload bridge incomplete: platform=${bridge.platform ?? 'null'} onLock=${String(bridge.hasOnLock)} ledger=${String(bridge.hasLedger)}`,
        )
      }

      await page.getByText('Set up your PIN', { exact: true }).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
      await capture(page, '01-pin-setup.png')

      await enterPin(page, 'New PIN, 6 digits', VERIFY_PIN)
      await page.getByText('Confirm your PIN', { exact: true }).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
      await enterPin(page, 'Confirm your PIN', VERIFY_PIN)
      await page.getByText('Your PIN is set', { exact: true }).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
      const continueBtn = page.getByRole('button', { name: 'Continue' })
      await continueBtn.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
      const shot = await capture(page, '02-pin-saved.png')

      await signIn(client)
      await waitForCondition(
        'Sentinel connection to fake Electrum after PIN setup',
        async () => (await client.portalProve.settings.electrumStatus.query()).connected,
        30_000,
        500,
      )
      await client.portalProve.price.setSettings.mutate({ source: 'mempool', fallbacks: false })

      const seedRes = await runHelper(['seed', '--run', runId])
      if (!seedRes.ok) {
        throw new Error(`helpers/verify seed failed:\n${seedRes.output}`)
      }
      const doctorRes = await runHelper(['doctor', '--run', runId])
      if (!doctorRes.ok) {
        throw new Error(`helpers/verify doctor failed after seed:\n${doctorRes.output}`)
      }

      await continueBtn.click()
      return {
        detail: 'window.desktop bridge verified, PIN set in UI, fallbacks off, seeded, doctor passed',
        screenshot: shot,
      }
    })

    if (check1Ok) {
      await runStep('2. Home & seeded balances', async () => {
        const priceBefore = await fetchFakeUsdPrice(runState.fakes.mempoolPort)
        await page.getByText('1.79999', { exact: false }).first().waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        await page
          .getByText('3 tracked', { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })

        const recentStatementsSection = page
          .getByRole('heading', { name: 'Recent Statements', exact: true })
          .locator('xpath=../..')
        await recentStatementsSection
          .getByRole('button', { name: /^View statement created / })
          .first()
          .waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        await recentStatementsSection
          .getByText(/Period:\s*(?:Jan 1\s*[-–]\s*(?:31|Feb 1),\s*2026|Dec 31,\s*2025\s*[-–]\s*Jan 31,\s*2026)/)
          .first()
          .waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })

        const helpHref = await page.locator('a[aria-label="Help"]').getAttribute('href')
        if (helpHref === null || !helpHref.includes('utm_content=desktop-mac')) {
          throw new Error(`Expected Help link to include utm_content=desktop-mac, got: ${helpHref ?? 'null'}`)
        }

        const portfolioUsdLocator = page
          .locator('p', { hasText: '1.79999' })
          .first()
          .locator('xpath=following-sibling::p[1]')
        const renderedUsd = await waitForValue(
          'formatted portfolio USD total on Home',
          async () => {
            const text = await portfolioUsdLocator.innerText().catch(() => '')
            return parseScopedUsdAmount(text)
          },
          UI_TIMEOUT_MS,
          250,
        )
        const priceAfter = await fetchFakeUsdPrice(runState.fakes.mempoolPort)
        const expectedBefore = SEEDED_TOTAL_BTC * priceBefore
        const expectedAfter = SEEDED_TOTAL_BTC * priceAfter
        const expectedSummary =
          expectedBefore === expectedAfter
            ? `$${expectedBefore.toFixed(2)}`
            : `$${expectedBefore.toFixed(2)} or $${expectedAfter.toFixed(2)}`
        if (!matchesAnyPortfolioUsdQuote(renderedUsd, [expectedBefore, expectedAfter], SEEDED_ACCOUNT_COUNT)) {
          throw new Error(
            `Home portfolio USD ($${renderedUsd.toFixed(2)}) does not match fake mempool quote (${expectedSummary} ± $${(SEEDED_ACCOUNT_COUNT * 0.01).toFixed(2)})`,
          )
        }

        const shot = await capture(page, '03-home.png')
        return {
          detail: `Home rendered 1.79999 BTC, 3 tracked, Jan 2026 statement row, portfolio USD $${renderedUsd.toFixed(2)} (expected ${expectedSummary}), Help has desktop-mac`,
          screenshot: shot,
        }
      })

      await runStep('3. Lock, wrong PIN, hide-on-close & second-instance', async () => {
        await page.locator('button[aria-label="Lock"]').click()
        await page.getByText('Enter your PIN', { exact: true }).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })

        await enterPin(page, 'PIN, 6 digits', '111111')
        await page
          .getByText('Wrong PIN', { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        await capture(page, '04-wrong-pin.png')

        await enterPin(page, 'PIN, 6 digits', VERIFY_PIN)
        await page.getByText('Enter your PIN', { exact: true }).waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
        await page.getByText('1.79999', { exact: false }).first().waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })

        if (!isOurProcess(runState.sentinel)) {
          throw new Error('Electron exited before close-to-hide check')
        }
        process.kill(runState.sentinel.pid, 'SIGUSR2')
        if (!isOurProcess(runState.sentinel)) {
          throw new Error('Electron exited on BrowserWindow.close() instead of hiding to tray')
        }
        await page.getByText('Enter your PIN', { exact: true }).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })

        const bundleProblem = verifyCapableBundleProblem(appBundle)
        if (bundleProblem !== null) {
          throw new Error(`Refusing second-instance launch: ${bundleProblem}`)
        }
        const second = await runAsync(electronBin, [`--user-data-dir=${userDataDir}`], {
          cwd: REPO_ROOT,
          env: ChildEnv.with({ BCC_VERIFY_CONFIG: verifyConfigFile }),
          timeoutMs: 10_000,
        })
        if (second.timedOut || second.code !== 0) {
          throw new Error(
            `Second Electron instance failed: timedOut=${String(second.timedOut)} code=${String(second.code)} stderr=${second.stderr.trim()}`,
          )
        }
        if (!isOurProcess(runState.sentinel)) {
          throw new Error('Primary Electron process died after second instance launch')
        }
        const targetCount = await countCdpPageTargets(cdpPort)
        if (targetCount !== 1) {
          throw new Error(`Expected 1 CDP page target after second-instance activation, got ${targetCount}`)
        }

        await enterPin(page, 'PIN, 6 digits', VERIFY_PIN)
        await page.getByText('Enter your PIN', { exact: true }).waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
        await page.getByText('1.79999', { exact: false }).first().waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        const shot = await capture(page, '05-unlocked-after-second-instance.png')
        return {
          detail:
            'Lock, wrong PIN rejected, hide-on-close stayed alive & locked, second instance exited 0 with 1 window',
          screenshot: shot,
        }
      })

      await runStep('4. Settings (desktop, Electrum CRUD, Statement source, WAL)', async () => {
        await page.locator('a[aria-label="Settings"]').click()
        await page.getByRole('heading', { name: 'Settings' }).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        for (const section of [
          'Personal information',
          'Security',
          'Bitcoin price',
          'Statement data',
          'Electrum Server',
        ]) {
          await page.getByText(section, { exact: true }).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        }
        await page
          .getByText('Connected', { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        const shot = await capture(page, '06-settings-desktop.png')

        const initialSnapshot = await client.portalProve.settings.connectionProfiles.list.query()
        const originalProfile =
          initialSnapshot.profiles.find((p) => p.id === initialSnapshot.activeId) ?? initialSnapshot.profiles[0]
        if (originalProfile === undefined) {
          throw new Error('No initial desktop Electrum connection profile found')
        }

        await page.getByRole('button', { name: 'New connection' }).click()
        await page.locator('#connection-nickname').fill('Verify Fake Backup')
        await page.locator('#connection-host').fill('127.0.0.1')
        await page.locator('#connection-port').fill(String(runState.fakes.electrumPort))
        await page.locator('#connection-protocol').selectOption('tcp')

        await page.getByRole('button', { name: 'Test Connection' }).click()
        await page
          .locator('[role="alert"]')
          .filter({ hasText: /connected|reachable|success/i })
          .waitFor({
            state: 'visible',
            timeout: UI_TIMEOUT_MS,
          })

        await page.getByRole('button', { name: 'Save & Connect' }).click()
        await waitForCondition(
          'Verify Fake Backup connection profile to become active',
          async () => {
            const snapshot = await client.portalProve.settings.connectionProfiles.list.query()
            const backup = snapshot.profiles.find((p) => p.nickname === 'Verify Fake Backup')
            return backup !== undefined && snapshot.activeId === backup.id
          },
          UI_TIMEOUT_MS,
          300,
        )

        await page.reload({ waitUntil: 'domcontentloaded' })
        await unlockIfLocked(page)
        await page
          .getByRole('button', { name: /^Verify Fake Backup/ })
          .waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        const reloadedSnapshot = await client.portalProve.settings.connectionProfiles.list.query()
        const reloadedBackup = reloadedSnapshot.profiles.find((p) => p.nickname === 'Verify Fake Backup')
        if (reloadedBackup === undefined || reloadedSnapshot.activeId !== reloadedBackup.id) {
          throw new Error(
            `Expected Verify Fake Backup to remain active after reload (activeId=${reloadedSnapshot.activeId ?? 'null'})`,
          )
        }

        await page
          .getByRole('button', {
            name: new RegExp(`^${originalProfile.nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
          })
          .click()
        await page.getByRole('button', { name: 'Connect', exact: true }).click()
        await waitForCondition(
          `original connection profile "${originalProfile.nickname}" to become active`,
          async () =>
            (await client.portalProve.settings.connectionProfiles.list.query()).activeId === originalProfile.id,
          UI_TIMEOUT_MS,
          300,
        )
        const restoredSnapshot = await client.portalProve.settings.connectionProfiles.list.query()
        if (restoredSnapshot.activeId !== originalProfile.id) {
          throw new Error(
            `Expected original profile ${originalProfile.id} to be active, got ${restoredSnapshot.activeId ?? 'null'}`,
          )
        }

        await page.getByRole('button', { name: /^Verify Fake Backup/ }).click()
        await page.locator('button[aria-label="Delete Verify Fake Backup"]').click()
        await page.getByRole('button', { name: 'Delete connection' }).click()
        await page
          .getByRole('button', { name: /^Verify Fake Backup/ })
          .waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })

        await page.getByText('Configured Electrum server', { exact: true }).click()
        await page
          .getByText('Statement source saved', { exact: true })
          .waitFor({ state: 'attached', timeout: UI_TIMEOUT_MS })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await unlockIfLocked(page)
        await page.getByText('Statement data', { exact: true }).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        const electrumChecked = await page.locator('input[type="radio"][value="electrum"]').isChecked()
        if (!electrumChecked) {
          throw new Error('Statement data setting "Configured Electrum server" did not persist across reload')
        }
        await page
          .getByRole('radiogroup', { name: 'Look up transactions on' })
          .getByText('mempool.space', { exact: true })
          .click()
        await page
          .getByText('Statement source saved', { exact: true })
          .waitFor({ state: 'attached', timeout: UI_TIMEOUT_MS })

        await page.locator('#user-name').fill('Verify Electron Smoke')
        await page.getByRole('button', { name: 'Save name' }).click()
        await page.getByText('Name saved', { exact: true }).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await unlockIfLocked(page)
        const nameInput = page.locator('#user-name')
        await nameInput.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        await waitForCondition(
          'persisted Your name "Verify Electron Smoke"',
          async () => (await nameInput.inputValue()) === 'Verify Electron Smoke',
          UI_TIMEOUT_MS,
          200,
        )

        const journal = await runSqlQuery('SELECT * FROM pragma_journal_mode')
        const settingsRows = await runSqlQuery('SELECT key, value FROM settings ORDER BY key')
        const connectionRows = await runSqlQuery(
          'SELECT id, nickname, host, port, protocol, tor_enabled, revision FROM desktop_connection_profiles ORDER BY id',
        )
        const profileRows = await runSqlQuery('SELECT id, length(pin_hash) AS pin_hash_len FROM profiles')

        const stored = { journal, settings: settingsRows, connections: connectionRows, profiles: profileRows }
        writeFileSync(join(evidenceDir, 'stored.json'), `${JSON.stringify(stored, null, 2)}\n`)

        const mode = String(journal[0]?.['journal_mode'] ?? '').toLowerCase()
        if (mode !== 'wal') {
          throw new Error(`Expected SQLite journal_mode "wal", got "${mode}"`)
        }
        const pinLen = Number(profileRows[0]?.['pin_hash_len'] ?? 0)
        if (pinLen <= 0) {
          throw new Error('Expected non-empty profiles.pin_hash in SQLite')
        }
        const savedUserName = settingsRows.find((row) => row['key'] === 'user_name')?.['value']
        if (savedUserName !== 'Verify Electron Smoke') {
          throw new Error(
            `Expected settings.user_name="Verify Electron Smoke" in SQLite, got "${String(savedUserName)}"`,
          )
        }
        if (!connectionRows.some((row) => row['id'] === originalProfile.id)) {
          throw new Error(`Expected original connection profile ${originalProfile.id} to remain in SQLite`)
        }
        if (connectionRows.some((row) => row['nickname'] === 'Verify Fake Backup')) {
          throw new Error('Expected deleted connection profile "Verify Fake Backup" to be absent from SQLite')
        }

        return {
          detail:
            'Desktop sections, Electrum add/test/connect/reload/delete, Statement source reload, Your name & SQLite WAL verified',
          screenshot: shot,
        }
      })

      await runStep('5. Bundled Tor startup', async () => {
        await page.getByRole('button', { name: 'New connection' }).click()
        const torCheckbox = page.locator('#connection-tor')
        if (!(await torCheckbox.isChecked())) {
          await page.locator('label[for="connection-tor"]').click()
        }

        interface TorSnapshot {
          state: 'stopped' | 'starting' | 'ready' | 'failed' | 'unavailable'
          message?: string
          socksReady?: boolean
          progress?: number
        }
        const startTime = Date.now()
        let socksReadyAt: number | null = null
        let lastTor: TorSnapshot = { state: 'stopped' }

        for (;;) {
          const status = await client.portalProve.settings.electrumStatus.query()
          const tor = status.tor
          lastTor = tor
          if (tor.socksReady === true && socksReadyAt === null) {
            socksReadyAt = Date.now()
          }
          if (tor.state === 'ready' || tor.state === 'failed' || tor.state === 'unavailable') {
            break
          }
          const elapsed = Date.now() - startTime
          if (elapsed >= TOR_ONLINE_TIMEOUT_MS) {
            break
          }
          if (
            torMode === 'allow-offline' &&
            socksReadyAt !== null &&
            Date.now() - socksReadyAt >= TOR_OFFLINE_WAIT_AFTER_SOCKS_MS
          ) {
            break
          }
          await wait(1_000)
        }

        const torDataExists = existsSync(join(userDataDir, 'tor-data'))
        const outcome = classifyTorOutcome(torMode, lastTor, torDataExists)
        const shot = await capture(page, '07-settings-tor.png')

        if (await torCheckbox.isChecked()) {
          await page.locator('label[for="connection-tor"]').click()
        }

        if (outcome.status === 'failed') {
          throw new Error(outcome.detail)
        }
        return {
          status: outcome.status === 'offline-unverified' ? 'offline-unverified' : 'pass',
          detail: outcome.detail,
          screenshot: shot,
        }
      })

      await runStep('6. Statement PDF preview & desktop download', async () => {
        await page.locator('a[href="/statements"]').first().click()
        const viewBtn = page.getByRole('button', { name: /^View statement created / }).first()
        await viewBtn.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        await viewBtn.click()
        await page
          .getByText('Verify Seed', { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })

        await page.locator('iframe[src^="blob:"]').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        await wait(600)
        const shot = await capture(page, '08-statement-preview.png')

        const downloadLogOffset = readLogSlice(electronLogPath, 0).length
        await page.getByRole('button', { name: 'Download' }).click()
        const completed = await waitForValue(
          'Electron will-download completion in electron.log',
          () => parseVerifyDownloadEvent(readLogSlice(electronLogPath, downloadLogOffset)),
          30_000,
          150,
        )
        if (completed.state !== 'completed') {
          throw new Error(`Expected Electron download state "completed", got "${completed.state}"`)
        }
        if (!completed.fileName.toLowerCase().endsWith('.pdf') || basename(completed.fileName) !== completed.fileName) {
          throw new Error(`Expected downloaded PDF filename without path separators, got "${completed.fileName}"`)
        }
        const pdfFile = join(downloadsDir, completed.fileName)
        if (!existsSync(pdfFile)) {
          throw new Error(`Electron reported completed download "${completed.fileName}", but ${pdfFile} does not exist`)
        }
        const archivedPdf = join(evidenceDir, 'statement-verify-seed.pdf')
        copyFileSync(pdfFile, archivedPdf)
        const pdfBytes = readFileSync(pdfFile)
        const parsedPdf = extractPdfText(pdfBytes)
        if (!parsedPdf.validHeader || parsedPdf.byteLength <= 1_000) {
          throw new Error(
            `Downloaded file is not a valid non-empty PDF (header=${String(parsedPdf.validHeader)}, bytes=${parsedPdf.byteLength})`,
          )
        }
        if (!pdfTextIncludes(parsedPdf.text, 'Verify Seed') || !pdfTextIncludes(parsedPdf.text, 'Verify Savings')) {
          throw new Error(
            `Downloaded PDF text is missing expected seeded content ("Verify Seed" / "Verify Savings"). Extracted snippet: ${parsedPdf.text.slice(0, 240)}`,
          )
        }
        return {
          detail: `Rendered blob preview and Electron saved valid ${parsedPdf.byteLength}-byte PDF (${completed.fileName}) containing Verify Seed & Verify Savings`,
          screenshot: shot,
        }
      })

      await runStep('7. Runtime hygiene & doctor', async () => {
        const doctorRes = await runHelper(['doctor', '--run', runId])
        if (!doctorRes.ok) {
          throw new Error(`helpers/verify doctor failed:\n${doctorRes.output}`)
        }
        const leakedFds = await openFilesInDirs(runState.sentinel.pid, [
          join(appSupportDir, 'desktop'),
          join(appSupportDir, 'desktop-dev'),
        ])
        if (!existsSync(electronLogPath)) {
          throw new Error(`Expected Electron log at ${electronLogPath}`)
        }
        const foundMainErrors = findMainProcessErrors(readFileSync(electronLogPath, 'utf8'))
        mainProcessErrors.push(...foundMainErrors)
        const problems: string[] = []
        if (leakedFds.length > 0) {
          problems.push(
            `open files in real Application Support (${leakedFds.length}): ${leakedFds.slice(0, 3).join('; ')}`,
          )
        }
        if (foundMainErrors.length > 0) {
          problems.push(`main-process errors (${foundMainErrors.length}): ${foundMainErrors.slice(0, 3).join('; ')}`)
        }
        if (pageErrors.length > 0) {
          problems.push(`pageerror (${pageErrors.length}): ${pageErrors.slice(0, 3).join('; ')}`)
        }
        if (consoleErrors.length > 0) {
          problems.push(`console.error (${consoleErrors.length}): ${consoleErrors.slice(0, 3).join('; ')}`)
        }
        if (externalRequests.length > 0) {
          problems.push(`external requests (${externalRequests.length}): ${externalRequests.slice(0, 3).join('; ')}`)
        }
        if (problems.length > 0) {
          throw new Error(problems.join(' | '))
        }
        return {
          detail:
            'doctor passed; zero open files in Application Support/desktop*, zero main-process errors, zero pageerror, zero console.error, zero external requests',
        }
      })
    }

    await runStep('8. Clean shutdown & isolation', async () => {
      if (ctx.browser !== null) {
        await ctx.browser.close()
        ctx.browser = null
      }

      if (!isOurProcess(runState.sentinel)) {
        throw new Error('Electron leader was already gone before SIGTERM clean shutdown check')
      }
      const quit = await quitProcessCleanly(runState.sentinel, 12_000)
      if (!quit.wasRunning || !quit.exited || quit.survivors.length > 0) {
        throw new Error(
          `Electron did not exit cleanly within 12s (wasRunning=${String(quit.wasRunning)}, exited=${String(quit.exited)}, survivors=${quit.survivors.join(', ')})`,
        )
      }
      if (!existsSync(electronLogPath)) {
        throw new Error(`Expected Electron log at ${electronLogPath} after shutdown`)
      }
      const shutdownLogProblem = verifyCleanShutdownLog(readFileSync(electronLogPath, 'utf8'))
      if (shutdownLogProblem !== null) {
        throw new Error(shutdownLogProblem)
      }
      const sentinelListeners = listeners(runState.sentinel.port)
      const cdpListeners = listeners(cdpPort)
      if (sentinelListeners.length > 0 || cdpListeners.length > 0) {
        throw new Error(
          `Ports still open after clean quit: sentinel=[${sentinelListeners.join(',')}] cdp=[${cdpListeners.join(',')}]`,
        )
      }

      if (ctx.beforeDesktopSnapshot === null || ctx.beforeDesktopDevSnapshot === null) {
        throw new Error('Missing pre-launch Application Support snapshots')
      }
      const afterDesktop = snapshotDir(join(appSupportDir, 'desktop'))
      const afterDesktopDev = snapshotDir(join(appSupportDir, 'desktop-dev'))
      const isolationDiffs = [
        verifyFolderUntouched(ctx.beforeDesktopSnapshot, afterDesktop),
        verifyFolderUntouched(ctx.beforeDesktopDevSnapshot, afterDesktopDev),
      ].filter((diff): diff is string => diff !== null)
      if (isolationDiffs.length > 0) {
        throw new Error(`Detected unexpected Application Support changes: ${isolationDiffs.join(' | ')}`)
      }

      return {
        detail:
          'SIGTERM clean quit confirmed verify-shutdown:clean with 0 survivors, 0 open ports, and untouched Application Support folders',
      }
    })
  }
} catch (error) {
  ctx.orchestrationError = error instanceof Error ? error.message : String(error)
  traceLines.push('## Orchestration error', `- Error: ${ctx.orchestrationError}`, '')
  console.error(`FAIL               orchestration — ${ctx.orchestrationError}`)
} finally {
  if (ctx.browser !== null) {
    await ctx.browser.close().catch(() => undefined)
  }
  mkdirSync(evidenceDir, { recursive: true })
  if (existsSync(paths.logsDir)) {
    const destLogs = join(evidenceDir, 'logs')
    mkdirSync(destLogs, { recursive: true })
    for (const file of readdirSync(paths.logsDir)) {
      const src = join(paths.logsDir, file)
      try {
        if (statSync(src).isFile()) {
          copyFileSync(src, join(destLogs, file))
        }
      } catch {
        continue
      }
    }
  }
  if (ctx.launched && !keep) {
    const cleanupRes = await runHelper(['cleanup', '--run', runId])
    ctx.cleanedUp = cleanupRes.ok
    traceLines.push(`## Cleanup`, `- ok: ${String(cleanupRes.ok)}`, '')
  }

  const verdict = computeSmokeVerdict({
    steps,
    orchestrationError: ctx.orchestrationError,
    cleanupRequired: ctx.launched && !keep,
    cleanedUp: ctx.cleanedUp,
  })
  const overallStatus: StepStatus = verdict.status

  const summary = {
    runId,
    completedAt: new Date().toISOString(),
    status: overallStatus,
    failureReasons: verdict.reasons,
    orchestrationError: ctx.orchestrationError,
    torMode,
    versions: ctx.versions,
    build: ctx.state?.build ?? null,
    keep,
    cleanedUp: ctx.cleanedUp,
    steps,
    hygiene: {
      mainProcessErrors,
      pageErrors,
      consoleErrors,
      externalRequests,
    },
    screenshots,
  }
  writeFileSync(join(evidenceDir, 'smoke.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(evidenceDir, 'trace.md'), `${traceLines.join('\n').trimEnd()}\n`)

  const reportLines = [
    `# Electron smoke report: ${runId}`,
    '',
    `- Result: **${overallStatus.toUpperCase()}**`,
    `- Tor mode: ${torMode}`,
    `- Versions: ${Object.entries(ctx.versions)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
    ...(ctx.state === null
      ? []
      : [`- Commit: ${ctx.state.build.commit}${ctx.state.build.dirty ? ` (dirty tree ${ctx.state.build.tree})` : ''}`]),
    `- Completed: ${summary.completedAt}`,
    ...(verdict.reasons.length === 0 ? [] : ['', '## Failure reasons', '', ...verdict.reasons.map((r) => `- ${r}`)]),
    '',
    '## Checks',
    '',
    ...steps.map((step) => {
      const shot = step.screenshot === undefined ? '' : ` ([screenshot](${step.screenshot}))`
      return `- **${step.status.toUpperCase()}** — ${step.name} (${step.durationMs}ms): ${step.detail}${shot}`
    }),
    '',
    '## Artifacts',
    '',
    '- [smoke.json](smoke.json)',
    '- [trace.md](trace.md)',
    ...(existsSync(join(evidenceDir, 'stored.json')) ? ['- [stored.json](stored.json)'] : []),
    ...(existsSync(join(evidenceDir, 'statement-verify-seed.pdf'))
      ? ['- [statement-verify-seed.pdf](statement-verify-seed.pdf)']
      : []),
    ...(existsSync(join(evidenceDir, 'logs')) ? ['- [logs/](logs/)'] : []),
    '',
  ]
  writeFileSync(join(evidenceDir, 'report.md'), `${reportLines.join('\n').trimEnd()}\n`)

  console.log(`\nSmoke ${overallStatus.toUpperCase()} — evidence: ${evidenceDir}`)
  if (overallStatus === 'fail') {
    process.exit(1)
  }
}
