import { z } from 'zod'
import {
  Address,
  MultiSigAccount,
  Network,
  NetworkAccount,
  type NetworkAccountCheckedString,
  SingleSigAccount,
  Txid,
  TxidSchema,
  Xpub,
} from '../bitcoin'

export const bitcoinAddressString = z.string().transform((str, ctx) => {
  const address = Address.fromString(str)
  if (address.isErr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: address.unwrapErr().message })
    return z.NEVER
  }
  return address.unwrap()
})

export const bitcoinAddressDescriptor = z.string().transform((str, ctx) => {
  const address = Address.fromDescriptor(str)
  if (address.isErr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: address.unwrapErr().message })
    return z.NEVER
  }
  return address.unwrap()
})

export const bitcoinAddress = z.instanceof(Address)

export const bitcoinXpubStringSchema = z.string().transform((str, ctx) => {
  const xpub = Xpub.fromString(str)
  if (xpub.isErr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: xpub.unwrapErr().message })
    return z.NEVER
  }
  return xpub.unwrap()
})

// Backwards-compatible alias
export const bitcoinXpubString = bitcoinXpubStringSchema

export const bitcoinXpub = z.instanceof(Xpub)

export const bitcoinSinglesigAccountDescriptor = z.string().transform((str, ctx) => {
  const account = SingleSigAccount.fromDescriptor(str)
  if (account.isErr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: account.unwrapErr().message })
    return z.NEVER
  }
  return account.unwrap()
})

export const bitcoinMultisigAccountDescriptor = z.string().transform((str, ctx) => {
  const account = MultiSigAccount.fromDescriptor(str)
  if (account.isErr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: account.unwrapErr().message })
    return z.NEVER
  }
  return account.unwrap()
})

type NetworkSource = { network: Network | (() => Network) }

function isNetworkMethod(network: NetworkSource['network']): network is () => Network {
  return typeof network === 'function'
}

/**
 * Validates that the input is valid on the allowed networks.
 *
 * The input must be an object with a `network` property that is a function or a Network.
 */
export function bitcoinNetwork<T extends z.ZodType<NetworkSource>>(schema: T, allowed: Network[]): T {
  return schema.superRefine((value: NetworkSource, ctx) => {
    const n = isNetworkMethod(value.network) ? value.network() : value.network
    const network = allowed.find((allowedNetwork) => allowedNetwork.kind === n.kind)
    if (!network) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid network: ${n.toString()}` })
    }
  })
}

export const bitcoinNetworkStringEnum = ['bitcoin_mainnet', 'bitcoin_testnet', 'bitcoin_regtest'] as const
export const bitcoinNetworkString = z.enum(bitcoinNetworkStringEnum).transform((str) => Network.fromString(str))

export type BitcoinNetworkString = (typeof bitcoinNetworkStringEnum)[number]

export const bitcoinTxidString = TxidSchema

export const bitcoinTxidBuffer = z.instanceof(Buffer).transform((buf, ctx) => {
  const txid = Txid.fromBuffer(buf)
  if (txid.isErr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: txid.unwrapErr().message })
    return z.NEVER
  }
  return txid.unwrap()
})

export const bitcoinNetworkAccountString = z.custom<NetworkAccountCheckedString>().transform((str, ctx) => {
  const n = NetworkAccount.fromString(str)
  if (n.isErr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: n.unwrapErr().message })
    return z.NEVER
  }
  return n.unwrap()
})
