import { Account } from '@hoseki/packages/bitcoin/account'
import type { Block } from '@hoseki/packages/bitcoin/onchain'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { IndexSet } from '@hoseki/packages/collection'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { and, inArray, isNull } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { SentinelDb } from '../../db/drizzle'
import { accounts } from '../../db/schema'
import { getLatestWalletSnapshot, recordWalletSnapshot } from './snapshots'

/** A wallet balance fetched from Electrum by this process. */
export interface LiveWalletBalance {
  balanceSats: bigint
  /** When the scan finished. */
  fetchedAt: Date
  /** The chain tip read just before the scan, or null if it couldn't be read. */
  tip: Block | null
  /** Whether this balance was recorded as a snapshot. A history backfill's scans record none. */
  recorded: boolean
}

/** A wallet's newest known balance, from this process or its last snapshot, and whether a newer one is on the way. */
export interface WalletBalanceView {
  accountId: string
  /** Null until the wallet's first balance is known. */
  balanceSats: bigint | null
  /** When that balance was current. */
  asOf: Date | null
  /** The chain tip the balance was fetched at, when this process fetched it. */
  tip: Block | null
  /** A scan is running, such as one this read started. */
  syncing: boolean
  /** The latest scan failed; it stays true while a retry runs. */
  failed: boolean
}

/** The chain tip as far as a caller that can't wait long knows it. */
export interface CurrentTip {
  /** The tip Electrum just gave, or else one read in the last ten minutes; null if neither. */
  tip: Block | null
  /** Electrum answered the read with an error. */
  failed: boolean
}

/** The wallet was archived, deleted or reset while its balance was fetched, so callers leave it out. */
class WalletChangedError extends Error {
  public override readonly name = 'WalletChangedError'

  public constructor() {
    super('The wallet changed during its balance scan')
  }
}

type Scan = Promise<Result<LiveWalletBalance, Error>>

interface WalletState {
  /** Bumped when the wallet is archived, restored, deleted or the server changes, so older scans are dropped. */
  generation: number
  account: Account | null
  live: LiveWalletBalance | null
  scan: Scan | null
  failures: number
  retryAt: number
}

/** How long a fetched balance is reused before it counts as out of date. */
const BALANCE_MAX_AGE_MS = 60_000
/** A tip read this recently still stands in for the current one: about one block interval. */
const RECENT_TIP_MAX_AGE_MS = 10 * 60_000

/** How long a wallet whose scan failed `failures` times in a row waits before it is scanned again. */
export function retryDelayMs(failures: number): number {
  return Math.min(60_000, 10_000 * 2 ** (failures - 1))
}

/**
 * Owns live wallet balances. Callers that ask at the same time share one Electrum scan per wallet,
 * recent balances are reused, each wallet is scanned on its own so one failing wallet doesn't fail
 * the rest, and every successful scan is recorded as a balance snapshot. A wallet whose scan failed
 * isn't scanned again by reads until its retry delay has passed.
 */
export class WalletBalanceService {
  private readonly db: SentinelDb
  private readonly logger: Logger
  private readonly onchainProvider: ElectrumProvider
  private readonly states = new Map<string, WalletState>()
  private tipGeneration = 0
  private latestTip: { tip: Block; readAt: number } | null = null
  private tipRead: Promise<Result<Block, Error>> | null = null

  public constructor(deps: { db: SentinelDb; logger: Logger; onchainProvider: ElectrumProvider }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'wallet-balances' })
    this.onchainProvider = deps.onchainProvider
  }

  /**
   * Each active wallet's newest known balance, without waiting on Electrum. Wallets that are out of
   * date and not waiting to retry a failure start a scan first, so they read as syncing. Archived and
   * unknown wallets are left out.
   */
  public async readBalances(accountIds: string[]): Promise<WalletBalanceView[]> {
    const wallets = await this.activeWallets(accountIds)
    const now = Date.now()
    for (const { id, state } of wallets) {
      if (state.scan === null && state.retryAt <= now && !isFresh(state.live)) {
        this.startScan(id, state).catch(() => {
          this.logger.warn({ accountId: id }, 'Could not finish a wallet balance refresh')
        })
      }
    }
    return Promise.all(
      wallets.map(async ({ id, state }): Promise<WalletBalanceView> => {
        const { generation } = state
        const recorded = await getLatestWalletSnapshot(this.db, id)
        const { live } = state
        const fromLive =
          live !== null && (recorded === null || live.fetchedAt.getTime() >= Date.parse(recorded.timestamp))
        return {
          accountId: id,
          balanceSats: fromLive ? live.balanceSats : (recorded?.balanceSats ?? null),
          asOf: fromLive ? live.fetchedAt : recorded === null ? null : new Date(recorded.timestamp),
          tip: fromLive ? live.tip : null,
          // Reset meanwhile, such as by a server change: a new scan is due, so pages keep polling.
          syncing: state.scan !== null || state.generation !== generation,
          failed: state.failures > 0,
        }
      }),
    )
  }

  /**
   * Live balances for the active wallets among `accountIds`, waiting for a scan of each one without a
   * balance from the last minute. With `anchoredTo`, a balance is reused only if its scan started at
   * that chain tip. Archived and unknown wallets are left out.
   *
   * A history backfill passes `record: false` for scans it starts, since it records the balance
   * itself together with the history it certifies.
   */
  public async getLiveBalances(
    accountIds: string[],
    options: { anchoredTo?: Block; record?: boolean } = {},
  ): Promise<Map<string, Result<LiveWalletBalance, Error>>> {
    const { anchoredTo, record = true } = options
    const matches = (live: LiveWalletBalance): boolean =>
      anchoredTo === undefined || (live.tip?.hash === anchoredTo.hash && live.tip.height === anchoredTo.height)
    return this.forEachWallet(await this.activeWallets(accountIds), async (id, state) => {
      if (state.live !== null && isFresh(state.live) && matches(state.live)) {
        return Ok(state.live)
      }
      if (state.scan !== null) {
        const shared = await state.scan
        if (shared.isErr() || matches(shared.unwrap())) {
          return shared
        }
      }
      // The caller read this tip before asking, so it already precedes the scan.
      return this.startScan(id, state, anchoredTo, record)
    })
  }

  /**
   * Scans every active wallet and records each balance, joining scans already running; the periodic
   * snapshot uses it. Resolves once those scans finish.
   */
  public async refreshAll(): Promise<Map<string, Result<LiveWalletBalance, Error>>> {
    return this.forEachWallet(await this.activeWallets(undefined), async (id, state) => {
      const result = await (state.scan ?? this.startScan(id, state))
      if (result.isErr() || result.unwrap().recorded) {
        return result
      }
      // It joined a history backfill's scan, or recording failed: record it now.
      return this.record(id, result.unwrap())
    })
  }

  /** Forgets a wallet's balance and drops any scan in progress, after it was archived, restored or deleted. */
  public invalidate(accountId: string): void {
    const state = this.states.get(accountId)
    if (state !== undefined) {
      Object.assign(state, { generation: state.generation + 1, live: null, scan: null, failures: 0, retryAt: 0 })
    }
  }

  /** Forgets every balance and chain tip after the Electrum server changes. */
  public invalidateAll(): void {
    this.tipGeneration += 1
    this.latestTip = null
    this.tipRead = null
    for (const accountId of this.states.keys()) {
      this.invalidate(accountId)
    }
  }

  /**
   * The chain tip from Electrum if it answers within `waitMs`, or else the newest tip read in the last
   * ten minutes. Callers asking at the same time share one read, which carries on in the background.
   */
  public async currentTip(waitMs: number): Promise<CurrentTip> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const answered = await Promise.race([
      this.readTip(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null)
        }, waitMs)
      }),
    ])
    clearTimeout(timer)
    if (answered !== null) {
      return answered.isOk() ? { tip: answered.unwrap(), failed: false } : { tip: null, failed: true }
    }
    const recent = this.latestTip
    return {
      tip: recent !== null && Date.now() - recent.readAt <= RECENT_TIP_MAX_AGE_MS ? recent.tip : null,
      failed: false,
    }
  }

  /** Runs `balanceOf` for each wallet in parallel, leaving out wallets archived or deleted meanwhile. */
  private async forEachWallet(
    wallets: Array<{ id: string; state: WalletState }>,
    balanceOf: (id: string, state: WalletState) => Scan,
  ): Promise<Map<string, Result<LiveWalletBalance, Error>>> {
    const entries = await Promise.all(
      wallets.map(async ({ id, state }): Promise<[string, Result<LiveWalletBalance, Error>] | null> => {
        const { generation } = state
        const result = await balanceOf(id, state)
        const changed =
          state.generation !== generation || (result.isErr() && result.unwrapErr() instanceof WalletChangedError)
        return changed ? null : [id, result]
      }),
    )
    return new Map(entries.filter((entry) => entry !== null))
  }

  /** Reads the chain tip, sharing a read in progress, and remembers it unless the server changed meanwhile. */
  private async readTip(): Promise<Result<Block, Error>> {
    if (this.tipRead === null) {
      const generation = this.tipGeneration
      const read = (async (): Promise<Result<Block, Error>> => {
        const tip = await this.onchainProvider.getBlocksTip()
        if (tip.isOk() && generation === this.tipGeneration) {
          this.latestTip = { tip: tip.unwrap(), readAt: Date.now() }
        }
        return tip
      })().finally(() => {
        if (this.tipRead === read) {
          this.tipRead = null
        }
      })
      this.tipRead = read
    }
    return this.tipRead
  }

  private async activeWallets(accountIds: string[] | undefined): Promise<Array<{ id: string; state: WalletState }>> {
    if (accountIds?.length === 0) {
      return []
    }
    const rows = await this.db
      .select({ id: accounts.id, descriptor: accounts.descriptor })
      .from(accounts)
      .where(and(accountIds ? inArray(accounts.id, accountIds) : undefined, isNull(accounts.deletedAt)))
    return rows.map(({ id, descriptor }) => {
      let state = this.states.get(id)
      if (state === undefined) {
        state = { generation: 0, account: null, live: null, scan: null, failures: 0, retryAt: 0 }
        this.states.set(id, state)
      }
      if (state.account === null) {
        const parsed = Account.fromDescriptor(descriptor)
        state.account = parsed.isOk() ? parsed.unwrap() : null
      }
      return { id, state }
    })
  }

  private async startScan(accountId: string, state: WalletState, knownTip?: Block, record = true): Scan {
    if (state.account === null) {
      // It can't be scanned; report it as failing, so pages count it as empty instead of waiting on it.
      this.fail(state)
      this.logger.warn({ accountId }, 'Wallet descriptor could not be read')
      return Err(new Error('Invalid wallet descriptor'))
    }
    const scan = this.scan(accountId, state, state.account, knownTip, record).finally(() => {
      if (state.scan === scan) {
        state.scan = null
      }
    })
    state.scan = scan
    return scan
  }

  private async scan(
    accountId: string,
    state: WalletState,
    account: Account,
    knownTip: Block | undefined,
    record: boolean,
  ): Scan {
    const { generation } = state
    const started = performance.now()
    // Read before the scan, so the balance is known to reflect at least this tip.
    const tip = knownTip === undefined ? await this.readTip() : Ok(knownTip)
    let balance: Result<bigint, Error>
    try {
      balance = (await this.onchainProvider.getConfirmedAccountBalances(new IndexSet([account]))).map(
        (found) => found.get(account) ?? 0n,
      )
    } catch (cause) {
      balance = Err(cause instanceof Error ? cause : new Error('Wallet balance scan failed'))
    }
    const ms = Math.round(performance.now() - started)
    if (state.generation !== generation) {
      return Err(new WalletChangedError())
    }
    if (balance.isErr()) {
      const retryMs = this.fail(state)
      this.logger.warn(
        { accountId, failure: failureKind(balance.unwrapErr()), ms, retryMs },
        'Wallet balance scan failed',
      )
      return Err(balance.unwrapErr())
    }

    let live: LiveWalletBalance = {
      balanceSats: balance.unwrap(),
      fetchedAt: new Date(),
      tip: tip.isOk() ? tip.unwrap() : null,
      recorded: false,
    }
    if (record) {
      const recorded = await this.record(accountId, live)
      if (recorded.isErr() && recorded.unwrapErr() instanceof WalletChangedError) {
        return recorded
      }
      // A failed write keeps the balance, which is sound; the next refresh records it.
      live = recorded.unwrapOr(live)
    }
    if (state.generation !== generation) {
      return Err(new WalletChangedError())
    }
    Object.assign(state, { live, failures: 0, retryAt: 0 })
    this.logger.info({ accountId, ms }, 'Fetched wallet balance')
    return Ok(live)
  }

  /** Records `live` as a snapshot unless the wallet was archived or deleted meanwhile. */
  private async record(accountId: string, live: LiveWalletBalance): Scan {
    try {
      const recorded = await recordWalletSnapshot(
        this.db,
        accountId,
        live.balanceSats.toString(),
        live.fetchedAt.toISOString(),
      )
      return recorded ? Ok({ ...live, recorded: true }) : Err(new WalletChangedError())
    } catch {
      this.logger.warn({ accountId }, 'Could not record wallet balance snapshot')
      return Err(new Error('Could not record the wallet balance'))
    }
  }

  /** Counts a failed scan and returns how long the wallet now waits before reads scan it again. */
  private fail(state: WalletState): number {
    state.failures += 1
    const retryMs = retryDelayMs(state.failures)
    state.retryAt = Date.now() + retryMs
    return retryMs
  }
}

function isFresh(live: LiveWalletBalance | null): live is LiveWalletBalance {
  return live !== null && Date.now() - live.fetchedAt.getTime() <= BALANCE_MAX_AGE_MS
}

/** Why a scan failed, for logs: raw errors can quote descriptors, so only the kind is kept. */
function failureKind(error: Error): 'unreachable' | 'timeout' | 'error' {
  if (error.name === 'ElectrumTimeoutError' || error.message.startsWith('Connection timeout')) {
    return 'timeout'
  }
  if (
    error.name === 'ElectrumServerError' ||
    error.message.startsWith('Failed to parse') ||
    error.message.startsWith('Invalid JSON')
  ) {
    return 'error'
  }
  // Closed or refused connections, failed handshakes and Tor not being ready.
  return 'unreachable'
}
