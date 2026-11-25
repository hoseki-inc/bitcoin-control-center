import { pbkdf2Sync } from 'node:crypto'
import { MultiSigAccount, SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import * as descriptor from '@hoseki/packages/bitcoin/descriptor_utils'
import { ecc } from '@hoseki/packages/bitcoin/lib/ecc'
import { Xpub } from '@hoseki/packages/bitcoin/xpub'
import { BIP32Factory } from 'bip32'
import { EMULATOR_SEED_NAMES, type EmulatorSeedName } from './run'

/**
 * Public, well-known BIP-39 test-only mnemonics for hardware wallet emulator verification.
 *
 * WARNING: These are public BIP-39 / emulator test vectors. NEVER use them for real funds or real keys.
 * None of these accounts are added to `SEED_ACCOUNTS` in `chain.ts` or seeded by `seed.ts`, so the baseline
 * verification seed stays at 3 accounts and 1.79999 BTC.
 */

export { EMULATOR_SEED_NAMES, type EmulatorSeedName }

export const EMULATOR_DERIVATION_PATHS = {
  legacy: "m/44'/0'/0'",
  nestedSegwit: "m/49'/0'/0'",
  nativeSegwit: "m/84'/0'/0'",
  taproot: "m/86'/0'/0'",
  multisigNativeSegwit: "m/48'/0'/0'/2'",
} as const

export interface EmulatorSeed {
  readonly name: EmulatorSeedName
  readonly mnemonic: string
  readonly masterFingerprint: string
  readonly accounts: {
    readonly legacy: SingleSigAccount
    readonly nestedSegwit: SingleSigAccount
    readonly nativeSegwit: SingleSigAccount
    readonly taproot: SingleSigAccount
  }
  /** Extended public key at `m/48'/0'/0'/2'` (BIP-48 Native SegWit multisig). */
  readonly multisigXpub: Xpub
  /** Origin-tagged key expression without range, e.g. `[73c5da0a/48h/0h/0h/2h]xpub...`. */
  readonly multisigKeyOrigin: string
}

export interface EmulatorMultisigCosigner {
  readonly label: 'primary' | 'secondary' | 'cosigner3'
  readonly masterFingerprint: string
  readonly xpub: Xpub
  readonly keyOrigin: string
}

export interface EmulatorMultisig {
  readonly scriptType: 'p2wsh'
  readonly threshold: 2
  readonly derivationPath: typeof EMULATOR_DERIVATION_PATHS.multisigNativeSegwit
  readonly account: MultiSigAccount
  /** Origin-tagged `wsh(sortedmulti(2,...))#checksum` descriptor accepted directly by Control Center. */
  readonly descriptor: string
  readonly cosigners: readonly [EmulatorMultisigCosigner, EmulatorMultisigCosigner, EmulatorMultisigCosigner]
}

export interface EmulatorFundingOutput {
  readonly label: string
  readonly date: string
  readonly address: string
  readonly valueSats: number
}

const bip32 = BIP32Factory(ecc)

/** Derives the 64-byte BIP-39 seed from a mnemonic with an empty passphrase (PBKDF2-HMAC-SHA512, 2048 rounds). */
export function mnemonicToSeed(mnemonic: string): Buffer {
  return pbkdf2Sync(mnemonic.normalize('NFKD'), 'mnemonic'.normalize('NFKD'), 2048, 64, 'sha512')
}

function deriveXpub(root: ReturnType<typeof bip32.fromSeed>, path: string): Xpub {
  return Xpub.fromString(root.derivePath(path).neutered().toBase58()).expect(
    `Emulator test vector must derive a valid xpub at ${path}`,
  )
}

function buildSeed(name: EmulatorSeedName, mnemonic: string): EmulatorSeed {
  const root = bip32.fromSeed(mnemonicToSeed(mnemonic))
  const masterFingerprint = Buffer.from(root.fingerprint).toString('hex')
  const legacyXpub = deriveXpub(root, EMULATOR_DERIVATION_PATHS.legacy)
  const nestedSegwitXpub = deriveXpub(root, EMULATOR_DERIVATION_PATHS.nestedSegwit)
  const nativeSegwitXpub = deriveXpub(root, EMULATOR_DERIVATION_PATHS.nativeSegwit)
  const taprootXpub = deriveXpub(root, EMULATOR_DERIVATION_PATHS.taproot)
  const multisigXpub = deriveXpub(root, EMULATOR_DERIVATION_PATHS.multisigNativeSegwit)

  return {
    name,
    mnemonic,
    masterFingerprint,
    accounts: {
      legacy: new SingleSigAccount('p2pkh', legacyXpub),
      nestedSegwit: new SingleSigAccount('p2sh-p2wpkh', nestedSegwitXpub),
      nativeSegwit: new SingleSigAccount('p2wpkh', nativeSegwitXpub),
      taproot: new SingleSigAccount('p2tr', taprootXpub),
    },
    multisigXpub,
    multisigKeyOrigin: `[${masterFingerprint}/48h/0h/0h/2h]${multisigXpub.toString()}`,
  }
}

/**
 * Standard BIP-39 test vector (all-zero 128-bit entropy).
 * Funded on m/84'/0'/0'/0/0 (0.2 BTC), m/49'/0'/0'/0/0 (0.15 BTC), m/44'/0'/0'/0/0 (0.05 BTC),
 * and Key 1 of the deterministic 2-of-3 Native SegWit multisig (0.3 BTC).
 */
export const EMULATOR_PRIMARY: EmulatorSeed = buildSeed(
  'primary',
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
)

/**
 * Trezor official emulator default mnemonic (valid BIP-39 checksum).
 * Funded on m/84'/0'/0'/0/0 (0.12 BTC) and Key 2 of the deterministic 2-of-3 Native SegWit multisig.
 */
export const EMULATOR_SECONDARY: EmulatorSeed = buildSeed(
  'secondary',
  'all all all all all all all all all all all all',
)

/**
 * Public BIP-39 test vector (0x7f...7f 128-bit entropy).
 * Intentionally holds 0 BTC on the fake chain and is excluded from the 2-of-3 multisig so
 * zero-balance ("No wallets found") and non-matching cosigner ("Not a match :(") flows can be verified.
 */
export const EMULATOR_EMPTY: EmulatorSeed = buildSeed(
  'empty',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
)

export const EMULATOR_SEEDS: Readonly<Record<EmulatorSeedName, EmulatorSeed>> = {
  primary: EMULATOR_PRIMARY,
  secondary: EMULATOR_SECONDARY,
  empty: EMULATOR_EMPTY,
}

/**
 * Public BIP-39 test vector (0xff...ff 128-bit entropy) used solely as deterministic Key 3 of the 2-of-3
 * Native SegWit multisig so `EMULATOR_PRIMARY` + `EMULATOR_SECONDARY` reach quorum while `EMULATOR_EMPTY`
 * does not match any cosigner.
 */
const MULTISIG_THIRD_COSIGNER_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'

function buildMultisig2of3(): EmulatorMultisig {
  const cosigner3Root = bip32.fromSeed(mnemonicToSeed(MULTISIG_THIRD_COSIGNER_MNEMONIC))
  const cosigner3Fp = Buffer.from(cosigner3Root.fingerprint).toString('hex')
  const cosigner3Xpub = deriveXpub(cosigner3Root, EMULATOR_DERIVATION_PATHS.multisigNativeSegwit)
  const cosigner3Origin = `[${cosigner3Fp}/48h/0h/0h/2h]${cosigner3Xpub.toString()}`

  const cosigners: readonly [EmulatorMultisigCosigner, EmulatorMultisigCosigner, EmulatorMultisigCosigner] = [
    {
      label: 'primary',
      masterFingerprint: EMULATOR_PRIMARY.masterFingerprint,
      xpub: EMULATOR_PRIMARY.multisigXpub,
      keyOrigin: EMULATOR_PRIMARY.multisigKeyOrigin,
    },
    {
      label: 'secondary',
      masterFingerprint: EMULATOR_SECONDARY.masterFingerprint,
      xpub: EMULATOR_SECONDARY.multisigXpub,
      keyOrigin: EMULATOR_SECONDARY.multisigKeyOrigin,
    },
    {
      label: 'cosigner3',
      masterFingerprint: cosigner3Fp,
      xpub: cosigner3Xpub,
      keyOrigin: cosigner3Origin,
    },
  ]

  const account = MultiSigAccount.from({
    scriptType: 'p2wsh',
    threshold: 2,
    isSorted: true,
    xpubs: cosigners.map((cosigner) => cosigner.xpub),
  }).expect('Emulator 2-of-3 multisig account must be valid')

  const sortedOrigins = [...cosigners]
    .sort((a, b) => a.xpub.publicKey().toString('hex').localeCompare(b.xpub.publicKey().toString('hex')))
    .map((cosigner) => descriptor.accountRange(cosigner.keyOrigin))

  const checkedDescriptor = descriptor
    .checksum(descriptor.wsh(descriptor.sortedmulti(2, sortedOrigins)))
    .expect('Emulator 2-of-3 multisig descriptor checksum must be valid')

  return {
    scriptType: 'p2wsh',
    threshold: 2,
    derivationPath: EMULATOR_DERIVATION_PATHS.multisigNativeSegwit,
    account,
    descriptor: checkedDescriptor,
    cosigners,
  }
}

export const EMULATOR_MULTISIG_2OF3: EmulatorMultisig = buildMultisig2of3()

const SATS = 100_000_000

/**
 * Confirmed funding outputs added to the fake chain in `tools/verify/chain.ts`.
 * Every date is at noon UTC so dates match from UTC-11 to UTC+11.
 */
export const EMULATOR_FUNDING_OUTPUTS: readonly EmulatorFundingOutput[] = [
  {
    label: 'emulator-primary-native-segwit-deposit',
    date: '2026-01-15T12:00:00Z',
    address: EMULATOR_PRIMARY.accounts.nativeSegwit.receiveAddress(0).toString(),
    valueSats: 0.2 * SATS,
  },
  {
    label: 'emulator-primary-nested-segwit-deposit',
    date: '2026-01-16T12:00:00Z',
    address: EMULATOR_PRIMARY.accounts.nestedSegwit.receiveAddress(0).toString(),
    valueSats: 0.15 * SATS,
  },
  {
    label: 'emulator-primary-legacy-deposit',
    date: '2026-01-17T12:00:00Z',
    address: EMULATOR_PRIMARY.accounts.legacy.receiveAddress(0).toString(),
    valueSats: 0.05 * SATS,
  },
  {
    label: 'emulator-secondary-native-segwit-deposit',
    date: '2026-01-18T12:00:00Z',
    address: EMULATOR_SECONDARY.accounts.nativeSegwit.receiveAddress(0).toString(),
    valueSats: 0.12 * SATS,
  },
  {
    label: 'emulator-multisig-2of3-deposit',
    date: '2026-01-19T12:00:00Z',
    address: EMULATOR_MULTISIG_2OF3.account.receiveAddress(0).toString(),
    valueSats: 0.3 * SATS,
  },
] as const
