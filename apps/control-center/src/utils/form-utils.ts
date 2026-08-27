import { SingleSigAccount, type Xpub } from '@hoseki/packages/bitcoin'
import { Slip132 } from '@hoseki/packages/wallet'
import { Err, Ok, type Result } from '@patina/core'

export function validateBitcoinStringInput(value: string): Result<Xpub | SingleSigAccount | null, string> {
  if (value === '') {
    return Ok(null)
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
