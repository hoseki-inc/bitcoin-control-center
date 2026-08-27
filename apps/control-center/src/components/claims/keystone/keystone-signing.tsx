import type { SigningFlowProps } from '../../../lib/claim-flow'
import { KeystoneQrSigning } from './keystone-qr-signing'

export function KeystoneSigning(props: SigningFlowProps): JSX.Element {
  return <KeystoneQrSigning {...props} />
}
