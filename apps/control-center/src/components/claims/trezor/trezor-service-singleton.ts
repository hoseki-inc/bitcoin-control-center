import { TrezorService } from '@hoseki/packages/ui/wallet-ui/trezor/trezor-service'
import { browserLogger } from '../../../logger'

const trezorService = new TrezorService(browserLogger)
export { trezorService }
