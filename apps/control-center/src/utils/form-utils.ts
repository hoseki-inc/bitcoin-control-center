import { SingleSigAccount, type Xpub, containsExtendedPrivateKey } from '@hoseki/packages/bitcoin'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import { Slip132 } from '@hoseki/packages/wallet'

export function validateBitcoinStringInput(value: string): Result<Xpub | SingleSigAccount | null, string> {
  if (value === '') {
    return Ok(null)
  }

  if (containsExtendedPrivateKey(value)) {
    return Err("That's a private key. Paste the public key (xpub) or a watch-only descriptor.")
  }

  const extpk = Slip132.getXpubFromString(value)
  if (extpk.isOk()) {
    return Ok(extpk.unwrap())
  }

  const singleSigAccount = SingleSigAccount.fromDescriptor(value)
  if (singleSigAccount.isOk()) {
    return Ok(singleSigAccount.unwrap())
  }

  return Err('Invalid input, please enter a valid account descriptor or xPub/yPub/zPub key')
}
