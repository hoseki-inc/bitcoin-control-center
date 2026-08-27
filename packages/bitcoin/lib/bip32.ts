import BIP32Module from 'bip32'
import { cjsInterop } from '../../lib'
import { ecc } from './ecc'

export type { BIP32API, BIP32Interface } from 'bip32'

const BIP32 = cjsInterop(BIP32Module)
export const bip32 = BIP32(ecc)
