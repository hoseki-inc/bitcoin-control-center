import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Address, Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { IndexMap, IndexSet } from '@hoseki/packages/collection'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import { Slip132 } from '@hoseki/packages/wallet'
import pino from 'pino'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createAppContext } from '../../context'
import * as env from '../../env'
import { appRouter } from '../../modules/trpc/router'

const testnetTpub =
  'tpubDD79jZKTZMENaFCfsbnRp3vS3jL4qbrQXUXc8egs34ixe8ovvkUBRx9U1YHkk3aiQfGzLijUEVkjCBSDPT2DxN4NWKzZT9cT3RGkBm7NzcA'

async function setup(providerNetwork: Network = Network.Mainnet) {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-onchain-router-'))
  vi.stubEnv('DATA_DIR', directory)
  vi.stubEnv('ELECTRUM_HOST', 'localhost')
  vi.spyOn(env, 'loadEnv').mockReturnValue({
    ...env.loadEnv(),
    DATA_DIR: directory,
    BITCOIN_NETWORK: providerNetwork.kind === 'Mainnet' ? 'mainnet' : 'testnet',
  })
  vi.spyOn(ElectrumClient.prototype, 'connect').mockImplementation(asyncFn(async () => Ok(['test', '1.4'])))
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  })
  const app = (await createAppContext(pino({ level: 'silent' }), {})).unwrap()
  if (providerNetwork.kind === 'Regtest') {
    app.onchainProvider = new ElectrumProvider(Network.Regtest, {
      electrum: app.electrumClient,
      logger: app.logger,
    })
  }
  onTestFinished(() => {
    app.database.$client.close()
    app.electrumClient.disconnect()
  })
  return { app, onchain: appRouter.createCaller({ app }).portalProve.onchain }
}

it('scans only used addresses for balance and skips getConfirmedAddressBalances when empty', async () => {
  const { app, onchain } = await setup()
  const account = Wallets.singlesigNativeSegwitAccount
  const accountKey = new NetworkAccount(Network.Mainnet, account).toString()
  const receiveAddrs = account.receiveAddresses(0, 4, Network.Mainnet)
  const changeAddrs = account.changeAddresses(0, 4, Network.Mainnet)

  const usedSpy = vi.spyOn(app.onchainProvider, 'areAddressesUsed')
  const balanceSpy = vi.spyOn(app.onchainProvider, 'getConfirmedAddressBalances')

  usedSpy.mockImplementationOnce(asyncFn(async () => Ok(new IndexSet<Address>())))
  await expect(
    onchain.scanAccountChunk({ account: accountKey, chain: 'receive', startIndex: 0, count: 4 }),
  ).resolves.toEqual({ usedIndexes: [], balanceSats: '0' })
  expect(balanceSpy).not.toHaveBeenCalled()

  const usedReceive0 = receiveAddrs[0]
  const usedReceive2 = receiveAddrs[2]
  if (usedReceive0 === undefined || usedReceive2 === undefined) {
    throw new Error('Expected test addresses')
  }
  usedSpy.mockImplementationOnce(asyncFn(async () => Ok(new IndexSet<Address>([usedReceive0, usedReceive2]))))
  balanceSpy.mockImplementationOnce(
    asyncFn(async (addrs: IndexSet<Address>) =>
      Ok(
        new IndexMap<Address, bigint>(
          [...addrs].map((addr) => [addr, addr.toString() === usedReceive0.toString() ? 25_000_000n : 75_000_000n]),
        ),
      ),
    ),
  )

  await expect(
    onchain.scanAccountChunk({ account: accountKey, chain: 'receive', startIndex: 0, count: 4 }),
  ).resolves.toEqual({ usedIndexes: [0, 2], balanceSats: '100000000' })
  expect(balanceSpy).toHaveBeenCalledTimes(1)
  expect(balanceSpy.mock.calls[0]?.[0].size).toBe(2)

  const usedChange1 = changeAddrs[1]
  if (usedChange1 === undefined) {
    throw new Error('Expected test change address')
  }
  usedSpy.mockImplementationOnce(asyncFn(async () => Ok(new IndexSet<Address>([usedChange1]))))
  balanceSpy.mockImplementationOnce(asyncFn(async () => Ok(new IndexMap<Address, bigint>([[usedChange1, 5_000_000n]]))))
  await expect(
    onchain.scanAccountChunk({ account: accountKey, chain: 'change', startIndex: 0, count: 4 }),
  ).resolves.toEqual({ usedIndexes: [1], balanceSats: '5000000' })
})

it('rejects invalid accounts and masks Electrum errors in scanAccountChunk', async () => {
  const { app, onchain } = await setup()
  const accountKey = new NetworkAccount(Network.Mainnet, Wallets.singlesigNativeSegwitAccount).toString()

  await expect(
    onchain.scanAccountChunk({ account: 'not-an-account', chain: 'receive', startIndex: 0, count: 4 }),
  ).rejects.toThrow('Invalid account')

  vi.spyOn(app.onchainProvider, 'areAddressesUsed').mockImplementationOnce(
    asyncFn(async () => Err(new Error('secret host details'))),
  )
  await expect(
    onchain.scanAccountChunk({ account: accountKey, chain: 'receive', startIndex: 0, count: 4 }),
  ).rejects.toThrow("Couldn't check balances with Electrum")
})

it('rejects tpub scans against a Mainnet provider without querying Electrum', async () => {
  const { app, onchain } = await setup(Network.Mainnet)
  const tpub = Slip132.getXpubFromString(testnetTpub).unwrap()
  const testnetAccount = new SingleSigAccount('p2wpkh', tpub)
  const accountKey = new NetworkAccount(Network.Testnet, testnetAccount).toString()
  const usedSpy = vi.spyOn(app.onchainProvider, 'areAddressesUsed')

  await expect(
    onchain.scanAccountChunk({ account: accountKey, chain: 'receive', startIndex: 0, count: 10 }),
  ).rejects.toThrow("Couldn't check balances with Electrum")
  expect(usedSpy).not.toHaveBeenCalled()
})

it('allows tpub scans against a Regtest provider', async () => {
  const { app, onchain } = await setup(Network.Regtest)
  const tpub = Slip132.getXpubFromString(testnetTpub).unwrap()
  const testnetAccount = new SingleSigAccount('p2wpkh', tpub)
  const accountKey = new NetworkAccount(Network.Testnet, testnetAccount).toString()
  const regtestAddr0 = testnetAccount.receiveAddresses(0, 4, Network.Regtest)[0]
  if (regtestAddr0 === undefined) {
    throw new Error('Expected regtest address')
  }

  vi.spyOn(app.onchainProvider, 'areAddressesUsed').mockImplementationOnce(
    asyncFn(async () => Ok(new IndexSet<Address>([regtestAddr0]))),
  )
  vi.spyOn(app.onchainProvider, 'getConfirmedAddressBalances').mockImplementationOnce(
    asyncFn(async () => Ok(new IndexMap<Address, bigint>([[regtestAddr0, 12_500_000n]]))),
  )

  await expect(
    onchain.scanAccountChunk({ account: accountKey, chain: 'receive', startIndex: 0, count: 4 }),
  ).resolves.toEqual({ usedIndexes: [0], balanceSats: '12500000' })
})

it('rejects xpub scans against Testnet and Regtest providers without querying Electrum', async () => {
  const mainnetAccountKey = new NetworkAccount(Network.Mainnet, Wallets.singlesigNativeSegwitAccount).toString()

  for (const providerNetwork of [Network.Testnet, Network.Regtest]) {
    const { app, onchain } = await setup(providerNetwork)
    const usedSpy = vi.spyOn(app.onchainProvider, 'areAddressesUsed')

    await expect(
      onchain.scanAccountChunk({ account: mainnetAccountKey, chain: 'receive', startIndex: 0, count: 10 }),
    ).rejects.toThrow("Couldn't check balances with Electrum")
    expect(usedSpy).not.toHaveBeenCalled()
  }
})

it('rejects a mainnet-prefixed account containing a tpub against a Mainnet provider without querying Electrum', async () => {
  const { app, onchain } = await setup(Network.Mainnet)
  const tpub = Slip132.getXpubFromString(testnetTpub).unwrap()
  const testnetAccount = new SingleSigAccount('p2wpkh', tpub)
  const mixedAccountKey = new NetworkAccount(Network.Mainnet, testnetAccount).toString()
  const usedSpy = vi.spyOn(app.onchainProvider, 'areAddressesUsed')

  await expect(
    onchain.scanAccountChunk({ account: mixedAccountKey, chain: 'receive', startIndex: 0, count: 10 }),
  ).rejects.toThrow("Couldn't check balances with Electrum")
  expect(usedSpy).not.toHaveBeenCalled()
})
