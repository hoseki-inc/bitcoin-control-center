import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { loadDesktopVerifyConfig, parseDesktopVerifyConfig } from '../src/verify-config'

interface TempDirs {
  root: string
  appData: string
  scratch: string
}

function makeTempDirs(): TempDirs {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-verify-config-test-'))
  const appData = path.join(root, 'app-data')
  const scratch = path.join(root, 'scratch')
  fs.mkdirSync(appData, { recursive: true })
  fs.mkdirSync(scratch, { recursive: true })
  onTestFinished(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { root, appData, scratch }
}

interface TestVerifyPayload {
  userDataDir: string
  electrum: { host: string; port: number; protocol: string }
  mempoolApiUrl: string
  disableReleaseCheck: boolean
  downloadsDir: string
  releaseCheckUrl?: string
}

function validPayload(scratch: string): TestVerifyPayload {
  return {
    userDataDir: path.join(scratch, 'user-data'),
    electrum: { host: '127.0.0.1', port: 50001, protocol: 'tcp' },
    mempoolApiUrl: 'http://127.0.0.1:41234',
    disableReleaseCheck: true,
    downloadsDir: path.join(scratch, 'downloads'),
  }
}

describe('desktop verify config', () => {
  it('returns null when BCC_VERIFY_CONFIG is unset or blank', () => {
    const { appData } = makeTempDirs()
    expect(loadDesktopVerifyConfig(undefined, appData)).toBeNull()
    expect(loadDesktopVerifyConfig('', appData)).toBeNull()
    expect(loadDesktopVerifyConfig('   ', appData)).toBeNull()
  })

  it('loads and canonicalizes a valid scratch verify config file', () => {
    const { appData, scratch } = makeTempDirs()
    const file = path.join(scratch, 'verify-config.json')
    const payload = {
      ...validPayload(scratch),
      disableReleaseCheck: false,
      releaseCheckUrl: 'http://127.0.0.1:41234/latest.json',
    }
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8')

    const loaded = loadDesktopVerifyConfig(file, appData)
    expect(loaded).not.toBeNull()
    expect(loaded?.userDataDir).toBe(path.join(fs.realpathSync.native(scratch), 'user-data'))
    expect(loaded?.downloadsDir).toBe(path.join(fs.realpathSync.native(scratch), 'downloads'))
    expect(loaded?.electrum).toEqual({ host: '127.0.0.1', port: 50001, protocol: 'tcp' })
    expect(loaded?.mempoolApiUrl).toBe('http://127.0.0.1:41234')
    expect(loaded?.releaseCheckUrl).toBe('http://127.0.0.1:41234/latest.json')
    expect(loaded?.disableReleaseCheck).toBe(false)
  })

  it('requires a loopback releaseCheckUrl when disableReleaseCheck is false', () => {
    const { appData, scratch } = makeTempDirs()
    const missingUrl = { ...validPayload(scratch), disableReleaseCheck: false }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(missingUrl), appData, scratch)).toThrow(
      'requires releaseCheckUrl',
    )
  })

  it('rejects relative userDataDir or paths inside appData', () => {
    const { appData, scratch } = makeTempDirs()
    const relative = { ...validPayload(scratch), userDataDir: 'relative/user-data' }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(relative), appData, scratch)).toThrow('absolute path')

    const insideAppData = { ...validPayload(scratch), userDataDir: path.join(appData, 'custom') }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(insideAppData), appData, scratch)).toThrow('outside appData')

    const equalAppData = { ...validPayload(scratch), userDataDir: appData }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(equalAppData), appData, scratch)).toThrow('outside appData')
  })

  it('rejects userDataDir or downloadsDir outside the verify config directory', () => {
    const { root, appData, scratch } = makeTempDirs()
    const otherRun = path.join(root, 'other-run')
    fs.mkdirSync(otherRun, { recursive: true })

    const outsideUserData = { ...validPayload(scratch), userDataDir: path.join(otherRun, 'user-data') }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(outsideUserData), appData, scratch)).toThrow(
      'inside the verify config directory',
    )

    const outsideDownloads = { ...validPayload(scratch), downloadsDir: path.join(otherRun, 'downloads') }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(outsideDownloads), appData, scratch)).toThrow(
      'inside the verify config directory',
    )
  })

  it('rejects symlink paths that resolve inside appData', () => {
    const { appData, scratch } = makeTempDirs()
    const link = path.join(scratch, 'sneaky-link')
    fs.symlinkSync(appData, link)
    const viaSymlink = { ...validPayload(scratch), userDataDir: path.join(link, 'nested') }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(viaSymlink), appData, scratch)).toThrow('outside appData')
  })

  it('handles case-variant Library/Application Support/Desktop paths and ..foo children', () => {
    const { root, appData, scratch } = makeTempDirs()
    const darwinPlatform = process.platform === 'darwin' || process.platform === 'win32' ? undefined : 'darwin'
    const macAppSupport = path.join(root, 'Library', 'Application Support')
    fs.mkdirSync(path.join(macAppSupport, 'desktop'), { recursive: true })

    const caseVariantAppSupport = {
      ...validPayload(scratch),
      userDataDir: path.join(root, 'library', 'application support', 'Desktop'),
    }
    expect(() =>
      parseDesktopVerifyConfig(JSON.stringify(caseVariantAppSupport), macAppSupport, root, darwinPlatform),
    ).toThrow('outside appData')

    const caseVariantBasename = { ...validPayload(scratch), userDataDir: path.join(scratch, 'Desktop') }
    expect(() =>
      parseDesktopVerifyConfig(JSON.stringify(caseVariantBasename), appData, scratch, darwinPlatform),
    ).toThrow('desktop data folder name')

    const dotDotChildInsideAppData = { ...validPayload(scratch), userDataDir: path.join(appData, '..foo') }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(dotDotChildInsideAppData), appData, root)).toThrow(
      'outside appData',
    )

    const dotDotChildInsideScratch = { ...validPayload(scratch), userDataDir: path.join(scratch, '..foo') }
    const parsed = parseDesktopVerifyConfig(JSON.stringify(dotDotChildInsideScratch), appData, scratch)
    expect(parsed.userDataDir).toBe(path.join(fs.realpathSync.native(scratch), '..foo'))
  })

  it('rejects userDataDir or downloadsDir named desktop or desktop-dev', () => {
    const { appData, scratch } = makeTempDirs()
    for (const folder of ['desktop', 'desktop-dev']) {
      const badUserData = { ...validPayload(scratch), userDataDir: path.join(scratch, folder) }
      expect(() => parseDesktopVerifyConfig(JSON.stringify(badUserData), appData, scratch)).toThrow(
        'desktop data folder name',
      )

      const badDownloads = { ...validPayload(scratch), downloadsDir: path.join(scratch, folder) }
      expect(() => parseDesktopVerifyConfig(JSON.stringify(badDownloads), appData, scratch)).toThrow(
        'desktop data folder name',
      )
    }
  })

  it('rejects non-loopback Electrum, mempool, or release-check endpoints', () => {
    const { appData, scratch } = makeTempDirs()
    const badElectrumHost = {
      ...validPayload(scratch),
      electrum: { host: 'electrum.blockstream.info', port: 50001, protocol: 'tcp' },
    }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(badElectrumHost), appData, scratch)).toThrow('127.0.0.1')

    const badElectrumProtocol = {
      ...validPayload(scratch),
      electrum: { host: '127.0.0.1', port: 50002, protocol: 'ssl' },
    }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(badElectrumProtocol), appData, scratch)).toThrow('tcp')

    const badMempool = { ...validPayload(scratch), mempoolApiUrl: 'https://mempool.space' }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(badMempool), appData, scratch)).toThrow('127.0.0.1')

    const badReleaseCheck = {
      ...validPayload(scratch),
      disableReleaseCheck: false,
      releaseCheckUrl: 'https://www.bitcoincontrolcenter.com/latest.json',
    }
    expect(() => parseDesktopVerifyConfig(JSON.stringify(badReleaseCheck), appData, scratch)).toThrow('127.0.0.1')
  })
})
