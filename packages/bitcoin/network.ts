// Typed copy of bitcoinjs-lib/src/networks.js
import { type Result } from '../result'
import { Err, Ok } from '../result'

// Interfaces and objects are duplicated to get a nice Network interface instead of the readonly literal objects
export namespace Network {
  export interface Mainnet {
    kind: 'Mainnet'
    bech32: 'bc'
    messagePrefix: '\x18Bitcoin Signed Message:\n'
    bip32: {
      public: 0x0488b21e
      publicBuffer: Uint8Array
      private: 0x0488ade4
      privateBuffer: Uint8Array
    }
    pubKeyHash: 0x00
    pubKeyHashDecimal: 0
    scriptHash: 0x05
    scriptHashDecimal: 5
    wif: 0x80
    toString(): 'bitcoin_mainnet'
    toJSON(): 'bitcoin_mainnet'
  }
  export const Mainnet: Mainnet = {
    kind: 'Mainnet',
    bech32: 'bc',
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      publicBuffer: new Uint8Array([0x04, 0x88, 0xb2, 0x1e]),
      private: 0x0488ade4,
      privateBuffer: new Uint8Array([0x04, 0x88, 0xad, 0xe4]),
    },
    pubKeyHash: 0x00,
    pubKeyHashDecimal: 0,
    scriptHash: 0x05,
    scriptHashDecimal: 5,
    wif: 0x80,
    toString() {
      return 'bitcoin_mainnet'
    },
    toJSON() {
      return 'bitcoin_mainnet'
    },
  }

  export interface Testnet {
    kind: 'Testnet'
    bech32: 'tb'
    messagePrefix: '\x18Bitcoin Signed Message:\n'
    bip32: {
      public: 0x043587cf
      publicBuffer: Uint8Array
      private: 0x04358394
      privateBuffer: Uint8Array
    }
    pubKeyHash: 0x6f
    pubKeyHashDecimal: 111
    scriptHash: 0xc4
    scriptHashDecimal: 196
    wif: 0xef
    toString(): 'bitcoin_testnet'
    toJSON(): 'bitcoin_testnet'
  }
  export const Testnet: Testnet = {
    kind: 'Testnet',
    bech32: 'tb',
    messagePrefix: Mainnet.messagePrefix,
    bip32: {
      public: 0x043587cf,
      publicBuffer: new Uint8Array([0x04, 0x35, 0x87, 0xcf]),
      private: 0x04358394,
      privateBuffer: new Uint8Array([0x04, 0x35, 0x83, 0x94]),
    },
    pubKeyHash: 0x6f,
    pubKeyHashDecimal: 111,
    scriptHash: 0xc4,
    scriptHashDecimal: 196,
    wif: 0xef,
    toString() {
      return 'bitcoin_testnet'
    },
    toJSON() {
      return 'bitcoin_testnet'
    },
  }

  export interface Regtest {
    kind: 'Regtest'
    bech32: 'bcrt'
    messagePrefix: '\x18Bitcoin Signed Message:\n'
    bip32: {
      public: 0x043587cf
      publicBuffer: Uint8Array
      private: 0x04358394
      privateBuffer: Uint8Array
    }
    pubKeyHash: 0x6f
    pubKeyHashDecimal: 111
    scriptHash: 0xc4
    scriptHashDecimal: 196
    wif: 0xef
    toString(): 'bitcoin_regtest'
    toJSON(): 'bitcoin_regtest'
  }
  export const Regtest: Regtest = {
    kind: 'Regtest',
    bech32: 'bcrt',
    messagePrefix: Mainnet.messagePrefix,
    bip32: Testnet.bip32,
    pubKeyHash: Testnet.pubKeyHash,
    pubKeyHashDecimal: Testnet.pubKeyHashDecimal,
    scriptHash: Testnet.scriptHash,
    scriptHashDecimal: Testnet.scriptHashDecimal,
    wif: Testnet.wif,
    toString() {
      return 'bitcoin_regtest'
    },
    toJSON() {
      return 'bitcoin_regtest'
    },
  }

  export function fromString(str: 'bitcoin_mainnet' | 'bitcoin_testnet' | 'bitcoin_regtest'): Network {
    switch (str) {
      case 'bitcoin_mainnet':
        return Network.Mainnet
      case 'bitcoin_testnet':
        return Network.Testnet
      case 'bitcoin_regtest':
        return Network.Regtest
    }
  }

  export function fromStringRaw(str: string): Result<Network, Error> {
    switch (str) {
      case 'bitcoin_mainnet':
      case 'bitcoin_testnet':
      case 'bitcoin_regtest':
        return Ok(Network.fromString(str))
      default:
        return Err(new Error(`Invalid network: ${str}`))
    }
  }
}

export type Network = Network.Mainnet | Network.Testnet | Network.Regtest
