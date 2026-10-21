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
import { recordWalletSnapshot } from './snapshots'

/** A wallet balance fetched from Electrum by this process. */
export interface LiveWalletBalance {
  balanceSats: bigint
  /** When the scan finished. */
  fetchedAt: Date
  /** The chain tip read just before the scan, or null if it couldn't be read. */
  tip: Block | null
}

/** The wallet was archived, deleted or reset while its balance was fetched, so callers leave it out. */
export class WalletChangedError extends Error {
  public override readonly name = 'WalletChangedError'

  public constructor() {
    super('The wallet changed during its balance scan')
  }
}

/** Why a wallet's latest scan failed. Raw errors can quote descriptors, so only the kind is kept. */
export type WalletBalanceFailure = 'unreachable' | 'timeout' | 'error'

export interface WalletBalanceStatus {
  accountId: string
  live: LiveWalletBalance | null
  syncing: boolean
  failure: WalletBalanceFailure | null
}

interface WalletState {
  /** Bumped when the wallet is archived, restored, deleted or the server changes, so older scans are dropped. */
  generation: number
  account: Account | null
  live: LiveWalletBalance | null
  scan: Promise<Result<LiveWalletBalance, Error>> | null
  failure: WalletBalanceFailure | null
  failureCount: number
  retryAt: number
}

/** How long a fetched balance is reused before a caller that asks for a fresh one waits for a new scan. */
export const WALLET_BALANCE_MAX_AGE_MS = 60_000
const RETRY_INITIAL_DELAY_MS = 10_000
const RETRY_MAX_DELAY_MS = 60_000

/**
 * Owns live wallet balances. Callers that ask at the same time share one Electrum scan per wallet,
 * recent balances are reused, each wallet is scanned on its own so one failing wallet doesn't fail
 * the rest, and every successful scan is recorded as a balance snapshot.
 */
export class WalletBalanceService {
  private readonly db: SentinelDb
  private readonly logger: Logger
  private readonly onchainProvider: ElectrumProvider
  private readonly states = new Map<string, WalletState>()

  public constructor(deps: { db: SentinelDb; logger: Logger; onchainProvider: ElectrumProvider }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'wallet-balances' })
    this.onchainProvider = deps.onchainProvider
  }

  /**
   * Live balances for the active wallets among `accountIds`, scanning only those without a balance
   * fetched within `maxAgeMs`. With `anchoredTo`, a balance is reused only if its scan started at
   * that chain tip. Archived and unknown wallets are left out.
   *
   * A history backfill passes `recordSnapshot: false` for scans it starts, since it records the
   * balance itself together with the history it certifies.
   */
  public async getLiveBalances(
    accountIds: string[],
    options: { maxAgeMs?: number; anchoredTo?: Block; recordSnapshot?: boolean } = {},
  ): Promise<Map<string, Result<LiveWalletBalance, Error>>> {
    const maxAgeMs = options.maxAgeMs ?? WALLET_BALANCE_MAX_AGE_MS
    const { anchoredTo } = options
    const recordSnapshot = options.recordSnapshot ?? true
    const wallets = await this.activeWallets(accountIds)
    const entries = await Promise.all(
      wallets.map(async ({ id, state }): Promise<[string, Result<LiveWalletBalance, Error>] | null> => {
        const result = await this.liveBalance(state, id, maxAgeMs, anchoredTo, recordSnapshot)
        return this.isLeftOut(id, state, result) ? null : [id, result]
      }),
    )
    return new Map(entries.filter((entry) => entry !== null))
  }

  /**
   * Starts scans in the background for active wallets whose balance is older than the cache allows
   * and that aren't waiting to retry a failure. `force` scans every wallet, as the periodic snapshot does.
   * Resolves once those scans finish.
   */
  public async refreshAll(options: { force?: boolean } = {}): Promise<Map<string, Result<LiveWalletBalance, Error>>> {
    return this.refresh(undefined, options.force === true)
  }

  /** Like `refreshAll`, for the given wallets only. */
  public async refreshStale(accountIds: string[]): Promise<Map<string, Result<LiveWalletBalance, Error>>> {
    return this.refresh(accountIds, false)
  }

  /** Starts `refreshAll` (or `refreshStale` for the given wallets) without waiting for it. */
  public refreshInBackground(accountIds?: string[]): void {
    this.refresh(accountIds, false).catch(() => {
      this.logger.warn('Could not start wallet balance refreshes')
    })
  }

  /** What this process knows about each wallet right now, without waiting for anything. */
  public getStatus(accountId: string): WalletBalanceStatus {
    const state = this.states.get(accountId)
    return {
      accountId,
      live: state?.live ?? null,
      syncing: state?.scan != null,
      failure: state?.failure ?? null,
    }
  }

  /** Forgets a wallet's balance and drops any scan in progress, after it was archived, restored or deleted. */
  public invalidate(accountId: string): void {
    const state = this.states.get(accountId)
    if (state === undefined) {
      return
    }
    this.states.set(accountId, { ...emptyState(), generation: state.generation + 1, account: state.account })
  }

  /** Forgets every balance after the Electrum server changes. */
  public invalidateAll(): void {
    for (const accountId of this.states.keys()) {
      this.invalidate(accountId)
    }
  }

  private async refresh(
    accountIds: string[] | undefined,
    force: boolean,
  ): Promise<Map<string, Result<LiveWalletBalance, Error>>> {
    const wallets = await this.activeWallets(accountIds)
    const now = Date.now()
    const due = wallets.filter(
      ({ state }) =>
        force ||
        (state.scan === null &&
          state.retryAt <= now &&
          (state.live === null || !this.isFresh(state.live, WALLET_BALANCE_MAX_AGE_MS))),
    )
    const entries = await Promise.all(
      due.map(async ({ id, state }): Promise<[string, Result<LiveWalletBalance, Error>] | null> => {
        const result = await (state.scan ?? this.startScan(id, state))
        return this.isLeftOut(id, state, result) ? null : [id, result]
      }),
    )
    return new Map(entries.filter((entry) => entry !== null))
  }

  /** A wallet archived or deleted meanwhile is left out, as it would be had it been asked later. */
  private isLeftOut(id: string, state: WalletState, result: Result<LiveWalletBalance, Error>): boolean {
    return (
      this.states.get(id)?.generation !== state.generation ||
      (result.isErr() && result.unwrapErr() instanceof WalletChangedError)
    )
  }

  private async liveBalance(
    state: WalletState,
    id: string,
    maxAgeMs: number,
    anchoredTo: Block | undefined,
    recordSnapshot: boolean,
  ): Promise<Result<LiveWalletBalance, Error>> {
    const matches = (live: LiveWalletBalance): boolean =>
      anchoredTo === undefined || (live.tip?.hash === anchoredTo.hash && live.tip.height === anchoredTo.height)
    if (state.live !== null && this.isFresh(state.live, maxAgeMs) && matches(state.live)) {
      return Ok(state.live)
    }
    if (state.scan !== null) {
      const shared = await state.scan
      if (shared.isErr() || matches(shared.unwrap())) {
        return shared
      }
    }
    // The caller read this tip before asking, so it already precedes the scan.
    return this.startScan(id, state, anchoredTo, recordSnapshot)
  }

  private isFresh(live: LiveWalletBalance, maxAgeMs: number): boolean {
    return Date.now() - live.fetchedAt.getTime() <= maxAgeMs
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
        state = emptyState()
        this.states.set(id, state)
      }
      if (state.account === null) {
        const parsed = Account.fromDescriptor(descriptor)
        state.account = parsed.isOk() ? parsed.unwrap() : null
      }
      return { id, state }
    })
  }

  private async startScan(
    accountId: string,
    state: WalletState,
    knownTip?: Block,
    recordSnapshot = true,
  ): Promise<Result<LiveWalletBalance, Error>> {
    const { account, generation } = state
    if (account === null) {
      return Err(new Error('Invalid wallet descriptor'))
    }
    const scan = this.scan(accountId, account, generation, knownTip, recordSnapshot).finally(() => {
      const current = this.states.get(accountId)
      if (current?.scan === scan) {
        current.scan = null
      }
    })
    state.scan = scan
    return scan
  }

  private async scan(
    accountId: string,
    account: Account,
    generation: number,
    knownTip: Block | undefined,
    recordSnapshot: boolean,
  ): Promise<Result<LiveWalletBalance, Error>> {
    const started = performance.now()
    // Read before the scan, so the balance is known to reflect at least this tip.
    const tip = knownTip === undefined ? await this.onchainProvider.getBlocksTip() : Ok(knownTip)
    let balances: Result<Map<Account, bigint>, Error>
    try {
      balances = (await this.onchainProvider.getConfirmedAccountBalances(new IndexSet([account]))).map(
        (found) => new Map([[account, found.get(account) ?? 0n]]),
      )
    } catch (cause) {
      balances = Err(cause instanceof Error ? cause : new Error('Wallet balance scan failed'))
    }
    const ms = Math.round(performance.now() - started)

    const state = this.states.get(accountId)
    if (state?.generation !== generation) {
      return Err(new WalletChangedError())
    }
    if (balances.isErr()) {
      const failure = classifyFailure(balances.unwrapErr())
      state.failure = failure
      state.failureCount += 1
      const retryDelayMs = Math.min(RETRY_MAX_DELAY_MS, RETRY_INITIAL_DELAY_MS * 2 ** (state.failureCount - 1))
      state.retryAt = Date.now() + retryDelayMs
      this.logger.warn({ accountId, failure, ms, retryDelayMs }, 'Wallet balance scan failed')
      return Err(balances.unwrapErr())
    }

    const live: LiveWalletBalance = {
      balanceSats: balances.unwrap().get(account) ?? 0n,
      fetchedAt: new Date(),
      tip: tip.isOk() ? tip.unwrap() : null,
    }
    let recorded = true
    try {
      if (recordSnapshot) {
        recorded = await recordWalletSnapshot(
          this.db,
          accountId,
          live.balanceSats.toString(),
          live.fetchedAt.toISOString(),
        )
      }
    } catch {
      // The balance itself is sound, so keep it; only the history misses this point.
      this.logger.warn({ accountId }, 'Could not record wallet balance snapshot')
      recorded = false
      if (this.states.get(accountId)?.generation === generation) {
        this.recordSuccess(state, live)
        return Err(new Error('Could not record the wallet balance'))
      }
    }
    if (!recorded || this.states.get(accountId)?.generation !== generation) {
      return Err(new WalletChangedError())
    }
    this.recordSuccess(state, live)
    this.logger.info({ accountId, ms }, 'Fetched wallet balance')
    return Ok(live)
  }

  private recordSuccess(state: WalletState, live: LiveWalletBalance): void {
    state.live = live
    state.failure = null
    state.failureCount = 0
    state.retryAt = 0
  }
}

function emptyState(): WalletState {
  return { generation: 0, account: null, live: null, scan: null, failure: null, failureCount: 0, retryAt: 0 }
}

function classifyFailure(error: Error): WalletBalanceFailure {
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
