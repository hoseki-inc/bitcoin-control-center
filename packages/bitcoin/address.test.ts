import { Result } from '@patina/core'
import { expect, test } from 'vitest'
import { Address, type AddressType, FORMATS, type Format } from './address'
import { bip32, bitcoin } from './lib'

const seed = 'deadbeef000000000000000000000000'
const keyPair = Result.fromThrowable(() => {
  return bip32.fromSeed(Buffer.from(seed, 'hex'))
}).expect('valid key pair')
const testPublicKey = keyPair.neutered().publicKey

function mainnetPubkeyHash(pubkey: Buffer) {
  return bitcoin.payments.p2pkh({
    pubkey,
    network: bitcoin.networks.bitcoin,
  }).address
}

function mainnetScriptHash(pubkey: Buffer) {
  return bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2wpkh({
      pubkey,
      network: bitcoin.networks.bitcoin,
    }),
  }).address
}

function mainnetSegwit(pubkey: Buffer) {
  return bitcoin.payments.p2wpkh({
    pubkey,
    network: bitcoin.networks.bitcoin,
  }).address
}

function taprootInternalPubkey(pubkey: Buffer) {
  return pubkey.subarray(1, 33)
}

function mainnetTaproot(pubkey: Buffer) {
  return bitcoin.payments.p2tr({
    internalPubkey: taprootInternalPubkey(pubkey),
    network: bitcoin.networks.bitcoin,
  }).address
}

function testnetPubkeyHash(pubkey: Buffer) {
  return bitcoin.payments.p2pkh({
    pubkey,
    network: bitcoin.networks.testnet,
  }).address
}

function testnetScriptHash(pubkey: Buffer) {
  return bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2wpkh({
      pubkey,
      network: bitcoin.networks.testnet,
    }),
  }).address
}

function testnetSegwit(pubkey: Buffer) {
  return bitcoin.payments.p2wpkh({
    pubkey,
    network: bitcoin.networks.testnet,
  }).address
}

function testnetTaproot(pubkey: Buffer) {
  return bitcoin.payments.p2tr({
    internalPubkey: taprootInternalPubkey(pubkey),
    network: bitcoin.networks.testnet,
  }).address
}

function regtestSegwit(pubkey: Buffer) {
  return bitcoin.payments.p2wpkh({
    pubkey,
    network: bitcoin.networks.regtest,
  }).address
}

function regtestTaproot(pubkey: Buffer) {
  return bitcoin.payments.p2tr({
    internalPubkey: taprootInternalPubkey(pubkey),
    network: bitcoin.networks.regtest,
  }).address
}

const rawFixtures: Array<{ format: Format; address: string | undefined; type: AddressType }> = [
  { format: FORMATS.MAINNET_PUBKEY_HASH, address: mainnetPubkeyHash(testPublicKey), type: 'legacy' },
  { format: FORMATS.MAINNET_SCRIPT_HASH, address: mainnetScriptHash(testPublicKey), type: 'script' },
  { format: FORMATS.MAINNET_SEGWIT, address: mainnetSegwit(testPublicKey), type: 'segwit' },
  { format: FORMATS.MAINNET_TAPROOT, address: mainnetTaproot(testPublicKey), type: 'taproot' },
  { format: FORMATS.TESTNET_PUBKEY_HASH, address: testnetPubkeyHash(testPublicKey), type: 'legacy' },
  { format: FORMATS.TESTNET_SCRIPT_HASH, address: testnetScriptHash(testPublicKey), type: 'script' },
  { format: FORMATS.TESTNET_SEGWIT, address: testnetSegwit(testPublicKey), type: 'segwit' },
  { format: FORMATS.TESTNET_TAPROOT, address: testnetTaproot(testPublicKey), type: 'taproot' },
  { format: FORMATS.REGTEST_SEGWIT, address: regtestSegwit(testPublicKey), type: 'segwit' },
  { format: FORMATS.REGTEST_TAPROOT, address: regtestTaproot(testPublicKey), type: 'taproot' },
]

const fixtures = rawFixtures.filter((fixture, i): fixture is { format: Format; address: string; type: AddressType } => {
  if (!fixture.address) {
    throw new Error(`Invalid generated address for ${fixture.format.kind} v${fixture.format.version} at index ${i}`)
  }
  return true
})

test('fromString', () => {
  fixtures.forEach((fixture) => {
    const address = Address.fromString(fixture.address).expect('valid address')
    expect({
      format: address.format,
      address: address.toString(),
      descriptor: address.descriptor(),
      network: address.network(),
      type: address.type(),
    }).toEqual({
      format: fixture.format,
      address: fixture.address,
      descriptor: `addr(${fixture.address})`,
      network: fixture.format.network,
      type: fixture.type,
    })
  })
})

test('fromDescriptor', () => {
  fixtures.forEach((fixture) => {
    const a = Address.fromString(fixture.address).expect('valid address')
    const b = Address.fromDescriptor(`addr(${fixture.address})`).expect('valid address')
    expect(a).toEqual(b)
  })
})

test('eq', () => {
  const a = Address.fromString('1CqbkfcUn2wDWs13xEncHPuwc3ki6QGCxT').expect('valid address')
  const b = Address.fromString('1CqbkfcUn2wDWs13xEncHPuwc3ki6QGCxT').expect('valid address')
  expect(a.eq(b)).toEqual(true)
})
