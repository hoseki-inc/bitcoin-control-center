import { NetworkAccount, SingleSigAccount, type SingleSigAccountScriptType } from '@hoseki/packages/bitcoin'
import type { ScriptTypeBalanceState, ScriptTypeBalances } from '@hoseki/packages/ui/design-system'
import { singlesigEncodings } from '@hoseki/packages/ui/utils'
import { Slip132 } from '@hoseki/packages/wallet'
import { useEffect, useMemo, useState } from 'react'
import { trpc } from '../../../trpc'
import { isPlainXpub } from './tracked-wallet'
import {
  type ScanChunkInput,
  type ScanChunkResult,
  readActiveAccountScan,
  subscribeAccountScan,
  subscribeExistingAccountScan,
} from './xpub-scan-store'

function createInitialBalances(keys: Record<SingleSigAccountScriptType, string>): ScriptTypeBalances {
  return {
    p2pkh: readActiveAccountScan(keys.p2pkh) ?? { status: 'loading' },
    'p2sh-p2wpkh': readActiveAccountScan(keys['p2sh-p2wpkh']) ?? { status: 'loading' },
    p2wpkh: readActiveAccountScan(keys.p2wpkh) ?? { status: 'loading' },
    p2tr: readActiveAccountScan(keys.p2tr) ?? { status: 'loading' },
  }
}

function buildAccountKeys(raw: string): Record<SingleSigAccountScriptType, string> | null {
  const text = raw.trim()
  if (!isPlainXpub(text)) {
    return null
  }
  const xpub = Slip132.getXpubFromString(text).unwrapOr(null)
  if (xpub === null) {
    return null
  }
  return {
    p2pkh: new NetworkAccount(xpub.network, new SingleSigAccount('p2pkh', xpub)).toString(),
    'p2sh-p2wpkh': new NetworkAccount(xpub.network, new SingleSigAccount('p2sh-p2wpkh', xpub)).toString(),
    p2wpkh: new NetworkAccount(xpub.network, new SingleSigAccount('p2wpkh', xpub)).toString(),
    p2tr: new NetworkAccount(xpub.network, new SingleSigAccount('p2tr', xpub)).toString(),
  }
}

export function useXpubScriptBalances(raw: string): {
  balances: ScriptTypeBalances | undefined
  isScanning: boolean
} {
  const trimmed = raw.trim()
  const accountKeys = useMemo(() => buildAccountKeys(trimmed), [trimmed])
  const utils = trpc.useUtils()
  const [scanState, setScanState] = useState<{ key: string; balances: ScriptTypeBalances } | null>(null)

  useEffect(() => {
    if (accountKeys === null) {
      setScanState(null)
      return
    }
    const fetchChunk = async (input: ScanChunkInput): Promise<ScanChunkResult> =>
      utils.portalProve.onchain.scanAccountChunk.fetch(input, { staleTime: 60_000 })
    const cancelChunk = (input: ScanChunkInput): void => {
      void utils.portalProve.onchain.scanAccountChunk.cancel(input)
    }

    setScanState({ key: trimmed, balances: createInitialBalances(accountKeys) })

    const unsubscribers = singlesigEncodings.map((scriptType) =>
      subscribeAccountScan(
        accountKeys[scriptType],
        fetchChunk,
        (nextEntry) => {
          setScanState((prev) => {
            const base = prev?.key === trimmed ? prev.balances : createInitialBalances(accountKeys)
            return {
              key: trimmed,
              balances: { ...base, [scriptType]: nextEntry },
            }
          })
        },
        cancelChunk,
      ),
    )

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [accountKeys, trimmed, utils])

  return useMemo(() => {
    if (accountKeys === null) {
      return { balances: undefined, isScanning: false }
    }
    const balances = scanState?.key === trimmed ? scanState.balances : createInitialBalances(accountKeys)
    const isScanning = singlesigEncodings.some((scriptType) => balances[scriptType]?.status === 'loading')
    return { balances, isScanning }
  }, [accountKeys, scanState, trimmed])
}

export function useHandedOffAccountScan(accountKey: string | null): ScriptTypeBalanceState | undefined {
  const [scan, setScan] = useState<{ key: string; state: ScriptTypeBalanceState } | null>(() => {
    if (accountKey === null) {
      return null
    }
    const existing = readActiveAccountScan(accountKey)
    return existing !== undefined ? { key: accountKey, state: existing } : null
  })

  useEffect(() => {
    if (accountKey === null) {
      setScan(null)
      return
    }
    const unsubscribe = subscribeExistingAccountScan(accountKey, (nextState) => {
      setScan({ key: accountKey, state: nextState })
    })
    if (unsubscribe === null) {
      setScan(null)
      return
    }
    return () => {
      unsubscribe()
    }
  }, [accountKey])

  if (accountKey === null) {
    return undefined
  }
  if (scan?.key === accountKey) {
    return scan.state
  }
  return readActiveAccountScan(accountKey)
}
