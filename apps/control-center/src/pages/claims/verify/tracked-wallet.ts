import { MultiSigAccount, SingleSigAccount, type SingleSigAccountScriptType } from '@hoseki/packages/bitcoin'
import { getDefaultEncoding } from '@hoseki/packages/ui/design-system/forms/bitcoin-input-form-fields'
import { Slip132 } from '@hoseki/packages/wallet'
import { createMultisigClaimInputFromDescriptor } from '../../../components/multisig/multisig-from-descriptor'
import type { CreateMultisigKeystoreInput } from '../../../trpc/server-types'

export type TrackedWallet =
  | { kind: 'singlesig'; account: SingleSigAccount }
  | { kind: 'multisig'; account: MultiSigAccount; keystores: CreateMultisigKeystoreInput[] }

const keyAndBranch = /([a-zA-Z]pub[1-9A-HJ-NP-Za-km-z]+)([^,)]*)/g

/**
 * A descriptor as Control Center saves it: no checksum or key origins, and each key followed by its receive and change
 * branches. Null unless every key uses the same receive or change branch, written as /0/*, /1/*, /<0;1>/* or /**,
 * since each address combines every key's key at the same position.
 */
function asSaved(descriptor: string): string | null {
  const body = (descriptor.split('#')[0] ?? '').replace(/\[[^\]]*\]/g, '')
  const branches = new Set(
    Array.from(body.matchAll(keyAndBranch), ([, , branch]) => branch?.replace('/**', '/<0;1>/*')),
  )
  const [branch] = branches
  const isTrackable = branches.size === 1 && ['/0/*', '/1/*', '/<0;1>/*'].includes(branch ?? '')
  return isTrackable ? body.replace(keyAndBranch, (_, key: string) => `${key}/<0;1>/*`) : null
}

/** A plain xpub or tpub doesn't say which addresses it uses, so someone picks its script type. */
export function isPlainXpub(raw: string): boolean {
  const text = raw.trim()
  return (text.startsWith('xpub') || text.startsWith('tpub')) && Slip132.getXpubFromString(text).isOk()
}

/**
 * Reads an extended public key, or a single-sig or multisig descriptor that Control Center saves as written. Anything
 * the account parsers would read differently, such as a Taproot script path, a single address or another branch, is
 * rejected rather than tracked as a different wallet.
 */
export function parseTrackedWallet(raw: string, pickedScriptType: SingleSigAccountScriptType): TrackedWallet | null {
  const text = raw.trim()
  if (text.includes('multi(')) {
    if (asSaved(text) === null) {
      return null
    }
    // The importer also reads exports with Ypub or Zpub keys, but needs key origins.
    const imported = createMultisigClaimInputFromDescriptor(text, '').unwrapOr(null)
    const account = MultiSigAccount.fromDescriptor(imported?.account ?? text).unwrapOr(null)
    if (account === null || account.xpubs.length < 2) {
      return null
    }
    // Key origins are only needed to sign, so a descriptor without them is still enough to track.
    const keystores =
      imported?.keystores ??
      account.xpubs.map((xpub) => ({
        label: 'Key',
        derivationPath: null,
        publicKey: xpub.toString(),
        wallet: null,
        model: null,
      }))
    return { kind: 'multisig', account, keystores }
  }
  // A receive descriptor and its change descriptor can be pasted together; the first says enough.
  const first = text.split(/\s+/)[0] ?? text
  if (first.includes('(')) {
    const account = SingleSigAccount.fromDescriptor(first).unwrapOr(null)
    const saved = asSaved(first)
    return account !== null && saved !== null && saved === asSaved(account.descriptor())
      ? { kind: 'singlesig', account }
      : null
  }
  // Uppercase prefixes such as Ypub and Zpub are one multisig cosigner's key, not a wallet of its own.
  if (/^[A-Z]pub/.test(text)) {
    return null
  }
  const xpub = Slip132.getXpubFromString(text).unwrapOr(null)
  const scriptType = isPlainXpub(text) ? pickedScriptType : getDefaultEncoding(text)
  return xpub === null ? null : { kind: 'singlesig', account: new SingleSigAccount(scriptType, xpub) }
}
