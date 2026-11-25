import { checksum } from '@hoseki/packages/bitcoin/descriptor_utils'
import { bs58check } from '@hoseki/packages/bitcoin/lib'
import { containsExtendedPrivateKey } from '@hoseki/packages/bitcoin/xpub'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { Wallets } from '@hoseki/packages/testing'
import pino from 'pino'
import superjson from 'superjson'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { setupAppCaller } from './ownership.fixtures'
import { appRouter } from './router'

// Feeds extended private keys into every route field that takes a descriptor or key, then checks that
// no key reached the database, the logs, or what the route sent back.

// Input fields that carry a descriptor or key. A new route with one of these fields must be covered below.
const KEY_FIELDS = new Set(['account', 'accounts', 'descriptor', 'descriptorExport', 'publicKey'])

// BIP32 test vector 1 master key: a published vector, not a real wallet.
const masterXprv =
  'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'

function withVersion(versionHex: string): string {
  return bs58check.encode(Buffer.concat([Buffer.from(versionHex, 'hex'), bs58check.decode(masterXprv).subarray(4)]))
}

// The same key in every private format a wallet exports: xprv, tprv and the SLIP-132 variants.
const privateKeys = [
  masterXprv,
  withVersion('04358394'), // tprv
  withVersion('049d7878'), // yprv
  withVersion('04b2430c'), // zprv
  withVersion('0295b005'), // Yprv
  withVersion('02aa7a99'), // Zprv
]

const publicKeyPattern = /[xtyzuvYZUV]pub[1-9A-HJ-NP-Za-km-z]{100,}/g

/** Every way to swap one public key in `base` for one of the private keys. */
function withPrivateKeys(base: string): string[] {
  const [body = '', sum] = base.split('#')
  const positions = [...body.matchAll(publicKeyPattern)]
  expect(positions.length, `no public key in ${base}`).toBeGreaterThan(0)
  return positions.flatMap((position) =>
    privateKeys.map((key) => {
      const index = position.index
      const swapped = body.slice(0, index) + key + body.slice(index + position[0].length)
      return sum === undefined ? swapped : checksum(swapped).unwrapOr(swapped)
    }),
  )
}

const xpubs = Wallets.multisigNativeSegwitAccount.xpubs.map((xpub) => xpub.toString())
const singlesig = Wallets.singlesigLegacyAccount.toString()
const [firstXpub, secondXpub] = xpubs
if (firstXpub === undefined || secondXpub === undefined) {
  throw new Error('The test multisig needs two keys')
}
const taproot = checksum(`tr(${firstXpub}/<0;1>/*,pk(${secondXpub}/<0;1>/*))`).expect('taproot descriptor')
const multisig = Wallets.multisigNativeSegwitAccount.toString()
const keystore = { label: 'Key', wallet: null, model: null, derivationPath: null }
const multisigKeystores = (keys: string[]) => keys.map((publicKey) => ({ ...keystore, publicKey }))

type Caller = Awaited<ReturnType<typeof setupAppCaller>>['caller']

interface Case {
  route: string
  field: string
  /** Inputs with a private key in the field. */
  values: string[]
  /** Calls the route and returns what it sent back, or its error. */
  call: (caller: Caller, value: string) => Promise<string>
}

async function reply<T>(request: Promise<T>): Promise<string> {
  try {
    return superjson.stringify(await request)
  } catch (error) {
    return error instanceof Error ? `${error.message} ${JSON.stringify(error.cause ?? null)}` : 'non-Error rejection'
  }
}

const cases: Case[] = [
  {
    route: 'portalProve.accounts.create.singlesig',
    field: 'account',
    values: [singlesig, taproot].flatMap(withPrivateKeys),
    call: async (caller, account) =>
      reply(
        caller.portalProve.accounts.create.singlesig({
          network: 'bitcoin_mainnet',
          account,
          displayName: 'Wallet',
          keystore,
        }),
      ),
  },
  {
    route: 'portalProve.accounts.create.multisig',
    field: 'account',
    values: withPrivateKeys(multisig),
    call: async (caller, account) =>
      reply(
        caller.portalProve.accounts.create.multisig({
          network: 'bitcoin_mainnet',
          account,
          displayName: 'Wallet',
          keystores: multisigKeystores(xpubs),
        }),
      ),
  },
  {
    route: 'portalProve.accounts.create.multisig',
    field: 'keystores[].publicKey',
    values: privateKeys,
    call: async (caller, publicKey) =>
      reply(
        caller.portalProve.accounts.create.multisig({
          network: 'bitcoin_mainnet',
          account: multisig,
          displayName: 'Wallet',
          keystores: multisigKeystores([publicKey, ...xpubs.slice(1)]),
        }),
      ),
  },
  {
    route: 'portalProve.accounts.create.bitkey',
    field: 'descriptorExport',
    values: withPrivateKeys(Wallets.bitkeyExport),
    call: async (caller, descriptorExport) =>
      reply(caller.portalProve.accounts.create.bitkey({ descriptorExport, displayName: 'Bitkey' })),
  },
  {
    route: 'portalProve.accounts.get.byAccount',
    field: 'account',
    values: withPrivateKeys(singlesig),
    call: async (caller, account) =>
      reply(caller.portalProve.accounts.get.byAccount({ network: 'bitcoin_mainnet', account })),
  },
  {
    route: 'portalProve.registry.getOrCreateSinglesigChallengeMessage',
    field: 'account',
    values: withPrivateKeys(singlesig),
    call: async (caller, account) =>
      reply(caller.portalProve.registry.getOrCreateSinglesigChallengeMessage({ network: 'bitcoin_mainnet', account })),
  },
  {
    route: 'portalProve.onchain.bitcoinAccountBalances',
    field: 'accounts[]',
    values: [singlesig, multisig].flatMap(withPrivateKeys).map((account) => `mainnet::${account}`),
    call: async (caller, account) => reply(caller.portalProve.onchain.bitcoinAccountBalances({ accounts: [account] })),
  },
  {
    route: 'portalProve.onchain.scanAccountChunk',
    field: 'account',
    values: [singlesig, multisig].flatMap(withPrivateKeys).map((account) => `bitcoin_mainnet::${account}`),
    call: async (caller, account) =>
      reply(caller.portalProve.onchain.scanAccountChunk({ account, chain: 'receive', startIndex: 0, count: 10 })),
  },
]

const zodSchema = z.custom<z.ZodTypeAny>((value) => value instanceof z.ZodType)

/** Names of the leaf fields in a route's input, such as `keystores[].publicKey`. */
function inputFields(schema: z.ZodTypeAny, path: string): string[] {
  if (schema instanceof z.ZodObject) {
    const members = parseUnknown(z.record(z.string(), zodSchema), schema.shape).expect('object fields')
    return Object.entries(members).flatMap(([key, value]) => inputFields(value, path === '' ? key : `${path}.${key}`))
  }
  if (schema instanceof z.ZodArray) {
    return inputFields(parseUnknown(zodSchema, schema.element).expect('array element'), `${path}[]`)
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    return inputFields(parseUnknown(zodSchema, schema._def.innerType).expect('inner schema'), path)
  }
  if (schema instanceof z.ZodPipe) {
    const inner = schema.in instanceof z.ZodTransform ? schema.out : schema.in
    return inputFields(parseUnknown(zodSchema, inner).expect('inner schema'), path)
  }
  if (schema instanceof z.ZodUnion) {
    return parseUnknown(z.array(zodSchema), schema.options)
      .expect('union options')
      .flatMap((option) => inputFields(option, path))
  }
  return [path]
}

function keyFieldRoutes(): string[] {
  return Object.entries(appRouter._def.procedures).flatMap(([route, procedure]) => {
    const inputs = parseUnknown(z.array(zodSchema), procedure._def.inputs).expect('route inputs')
    const fields = inputs.flatMap((input) => inputFields(input, ''))
    return fields
      .filter((field) => KEY_FIELDS.has(field.replace(/\[\]$/, '').split('.').at(-1) ?? ''))
      .map((field) => `${route} ${field}`)
  })
}

async function databaseText(db: Awaited<ReturnType<typeof setupAppCaller>>['db']): Promise<string> {
  const tables = await db.$client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
  const rows = await Promise.all(
    tables.rows.map(async ({ name }) =>
      db.$client.execute(`SELECT * FROM "${parseUnknown(z.string(), name).expect('table name')}"`),
    ),
  )
  return JSON.stringify(rows.map((result) => result.rows))
}

function leaks(text: string): boolean {
  return containsExtendedPrivateKey(text) || privateKeys.some((key) => text.includes(key.slice(4)))
}

describe('private keys sent to the API', () => {
  it('covers every route field that takes a descriptor or key', () => {
    expect(keyFieldRoutes().sort()).toEqual(cases.map(({ route, field }) => `${route} ${field}`).sort())
  })

  it.each(cases.map((testCase) => [`${testCase.route} ${testCase.field}`, testCase] as const))(
    'never saves, logs or returns a private key sent as %s',
    async (_name, { values, call }) => {
      const logs: string[] = []
      const logger = pino(
        { level: 'trace' },
        {
          write: (line: string) => {
            logs.push(line)
          },
        },
      )
      const { caller, db } = await setupAppCaller(logger)

      for (const value of values) {
        const sentBack = await call(caller, value)
        expect(leaks(sentBack), `reply to ${value}: ${sentBack}`).toBe(false)
      }

      expect(leaks(await databaseText(db)), 'database').toBe(false)
      expect(leaks(logs.join('\n')), logs.join('\n')).toBe(false)
    },
    60_000,
  )
})
