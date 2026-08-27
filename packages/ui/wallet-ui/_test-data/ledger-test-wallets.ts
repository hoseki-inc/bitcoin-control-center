import { SingleSigAccount } from '@hoseki/packages/bitcoin'
import Decimal from 'decimal.js'
import type { HardwareWallet } from '..'

const wallet1: HardwareWallet = {
  label: 'Bitcoin 1',
  accountIndex: 1,
  rawInput:
    'xpub6CKn7Fv3mEyRpZThyJkHu3UqW3oh3rL9N4HxFcntHMpJ5jCQP19cgqb2jwvqUawUsiHBqUGh7gAkrjFhMi8Le4gdCdczpXf7HfZJjBsxLzP',
  displayName: 'Ledger Nano S Plus Bitcoin Native Segwit 1',
  account: SingleSigAccount.fromDescriptor(
    'wpkh(xpub6CKn7Fv3mEyRpZThyJkHu3UqW3oh3rL9N4HxFcntHMpJ5jCQP19cgqb2jwvqUawUsiHBqUGh7gAkrjFhMi8Le4gdCdczpXf7HfZJjBsxLzP/<0;1>/*)#w7mpjly0',
  ).expect(''),
  btcBalance: new Decimal(69420),
  usdBalance: new Decimal(100),
  derivationPath: null,
}

const wallet2: HardwareWallet = {
  label: 'Bitcoin 2',
  accountIndex: 1,
  rawInput:
    'xpub6CaGG2AAm2xgMpRunFXFXx9Ba1XdMnoVnE4BPCeXntuKHwXKzjNY96vTZMaKcoSVi23PYiP5GxCE9PBMvfDgF1tg35P4VbFynqyh9xMVRGB',
  displayName: 'Ledger Nano S Plus Bitcoin Segwit 1',
  account: SingleSigAccount.fromDescriptor(
    'sh(wpkh(xpub6CaGG2AAm2xgMpRunFXFXx9Ba1XdMnoVnE4BPCeXntuKHwXKzjNY96vTZMaKcoSVi23PYiP5GxCE9PBMvfDgF1tg35P4VbFynqyh9xMVRGB/<0;1>/*))#64gpstdx',
  ).expect(''),
  btcBalance: new Decimal(54321),
  usdBalance: new Decimal(123),
  derivationPath: null,
}

const wallet3: HardwareWallet = {
  label: 'Bitcoin 3',
  accountIndex: 1,
  rawInput:
    'xpub6BqN8FZQhMmbuUehywWNTkRjMAYpTNhqvu6fMiYx4dw9Bagf8218mXwD8QGMswfcAAiqxfUoiHiGcV1iE3oDG9rFBoyDBw1a6FJAFVQhc1j',
  displayName: 'Ledger Nano S Plus Bitcoin Legacy 3',
  account: SingleSigAccount.fromDescriptor(
    'pkh(xpub6BqN8FZQhMmbuUehywWNTkRjMAYpTNhqvu6fMiYx4dw9Bagf8218mXwD8QGMswfcAAiqxfUoiHiGcV1iE3oDG9rFBoyDBw1a6FJAFVQhc1j/<0;1>/*)#7h5yemqu',
  ).expect(''),
  btcBalance: new Decimal(1234567),
  usdBalance: new Decimal(99.69),
  derivationPath: null,
}

export const HARDCODED_WALLETS: HardwareWallet[] = [wallet1, wallet2, wallet3]
