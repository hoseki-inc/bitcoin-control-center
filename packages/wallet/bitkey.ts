import { type KeyExpression, MultiSigAccount, type Wallet } from '../bitcoin'
import { Err, Ok, type Result } from '../result'
import { WalletImporter } from './wallet-importer'

/**
 * Bitkey's three keys, in the order the Bitkey app writes them into its descriptor:
 * the phone's app key, the Bitkey hardware key, and Block's server key.
 *
 * @see https://github.com/proto-at-block/bitkey/blob/main/app/domain/wallet/impl/src/commonMain/kotlin/build/wallet/bitcoin/descriptor/BitcoinMultiSigDescriptorBuilderImpl.kt
 */
export const bitkeyKeyRoles = ['app', 'hardware', 'server'] as const
export type BitkeyKeyRole = (typeof bitkeyKeyRoles)[number]

export const bitkeyKeyLabels = {
  app: 'Phone key',
  hardware: 'Bitkey key',
  server: 'Block key',
} as const satisfies Record<BitkeyKeyRole, string>

export interface BitkeyKey {
  role: BitkeyKeyRole
  keyExpression: KeyExpression
}

export interface BitkeyExport {
  wallet: Wallet.Multisig
  account: MultiSigAccount
  keys: BitkeyKey[]
}

const notABitkeyExport = 'This doesn’t look like a Bitkey wallet descriptor. Paste everything Bitkey exported.'

/**
 * Reads the "Current wallet descriptor" export from the Bitkey app (Settings → Exports):
 *
 * ```text
 * External: wsh(sortedmulti(2,[fp/84'/0'/0']xpub…/0/*,[fp/84'/0'/0']xpub…/0/*,[fp/84'/0'/0']xpub…/0/*))
 *
 * Internal: wsh(sortedmulti(2,[fp/84'/0'/0']xpub…/1/*,[fp/84'/0'/0']xpub…/1/*,[fp/84'/0'/0']xpub…/1/*))
 * ```
 *
 * A bare external descriptor is accepted too, in case only that line was copied.
 */
export function parseBitkeyExport(text: string): Result<BitkeyExport, Error> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length === 0) {
    return Err(new Error('Paste the wallet descriptor you exported from the Bitkey app.'))
  }

  let external: string | null = null
  let internal: string | null = null
  for (const line of lines) {
    const match = /^(external|internal)\s*:\s*(.+)$/i.exec(line)
    const label = match?.[1]?.toLowerCase()
    const descriptor = match?.[2] ?? line
    if (label === 'internal') {
      internal = descriptor
    } else if (label === 'external' || (lines.length === 1 && external === null)) {
      external = descriptor
    } else {
      return Err(new Error(notABitkeyExport))
    }
  }
  if (external === null) {
    return Err(new Error(notABitkeyExport))
  }

  // Our descriptor parser drops the child path, so check that each branch derives where Bitkey's does.
  if (!derivesEveryKeyFrom(external, 0) || (internal !== null && !derivesEveryKeyFrom(internal, 1))) {
    return Err(new Error(notABitkeyExport))
  }

  const externalWallet = WalletImporter.multisigFromDescriptor(external)
  if (externalWallet.isErr()) {
    return Err(new Error(notABitkeyExport))
  }
  const wallet = externalWallet.unwrap()

  if (internal !== null) {
    const internalWallet = WalletImporter.multisigFromDescriptor(internal)
    if (internalWallet.isErr() || !sameKeys(wallet, internalWallet.unwrap())) {
      return Err(new Error('The External and Internal descriptors don’t match. Export the descriptor again.'))
    }
  }

  if (
    wallet.scriptType !== 'p2wsh' ||
    !wallet.isSorted ||
    wallet.threshold !== 2 ||
    wallet.keyExpressions.length !== bitkeyKeyRoles.length
  ) {
    return Err(new Error('Bitkey wallets are 2-of-3 multisig, but this descriptor describes a different wallet.'))
  }

  const account = MultiSigAccount.fromWallet(wallet)
  if (account.network().kind !== 'Mainnet') {
    return Err(new Error('This descriptor is for a test network. Control Center tracks mainnet bitcoin only.'))
  }

  const keys = bitkeyKeyRoles.map((role, index) => ({ role, keyExpression: wallet.keyExpressions[index] }))
  if (!keys.every((key): key is BitkeyKey => key.keyExpression !== undefined)) {
    return Err(new Error(notABitkeyExport))
  }

  return Ok({ wallet, account, keys })
}

function derivesEveryKeyFrom(descriptor: string, branch: 0 | 1): boolean {
  const keyExpressions = /sortedmulti\(\s*\d+\s*,(.*)\)\s*\)/i.exec(descriptor.replace(/#\w+$/, ''))?.[1]?.split(',')
  return keyExpressions?.every((key) => key.trim().endsWith(`/${branch}/*`)) === true
}

function sameKeys(a: Wallet.Multisig, b: Wallet.Multisig): boolean {
  const keys = (wallet: Wallet.Multisig): string[] => wallet.keyExpressions.map((key) => key.toString())
  return a.threshold === b.threshold && keys(a).join() === keys(b).join()
}
