import { expect, it } from 'vitest'
import * as ledger from './ledger-utils'

/**
 * Manually extracted signature from Sparrow using
 * - message: "hoseki"
 * - path: "m/44'/0'/0'/0/0"
 * - address: "1WhmkUvv8GHmmz3xZYG53hYvoSrNv5csW"
 */
const sparrowSignature = 'IH3bPBLHKtcSZBzE54nCu60kJ4czaHcW8HWzd/2gqvmZa/ruYqrt0ExQMNcw+TqjSXG46Ey09MKwKZ31q8BsY4g='

it('encodes a hw-app-btc signature', () => {
  const signature = {
    v: 1,
    r: '7ddb3c12c72ad712641cc4e789c2bbad24278733687716f075b377fda0aaf999',
    s: '6bfaee62aaedd04c5030d730f93aa34971b8e84cb4f4c2b0299df5abc06c6388',
  }
  const encoded = ledger.encodeHwAppBtcSignature(signature)
  expect(encoded).toEqual(sparrowSignature)
})

it('encodes a device-signer-kit-bitcoin signature', () => {
  const signature = {
    v: 32,
    r: '0x7ddb3c12c72ad712641cc4e789c2bbad24278733687716f075b377fda0aaf999',
    s: '0x6bfaee62aaedd04c5030d730f93aa34971b8e84cb4f4c2b0299df5abc06c6388',
  } as const
  const encoded = ledger.encodeDeviceSignerKitBitcoinSignature(signature)
  expect(encoded).toEqual(sparrowSignature)
})
