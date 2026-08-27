import * as bitcoin from 'bitcoinjs-lib'
import { ecc } from './ecc'

bitcoin.initEccLib(ecc) // Initialize the ecc library for bitcoinjs-lib

export { bitcoin }
