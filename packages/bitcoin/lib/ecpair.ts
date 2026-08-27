import { ECPairFactory } from 'ecpair'
import { ecc } from './ecc'

const ecpair = ECPairFactory(ecc)

export {
  ECPairFactory,
  networks,
  type ECPairAPI,
  type ECPairInterface,
  type Signer,
  type SignerAsync,
  type TinySecp256k1Interface,
} from 'ecpair'

export { ecpair }
