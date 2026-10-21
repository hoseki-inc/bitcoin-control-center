import { DerivationPath, type DerivationPathString, type Xpub } from '@hoseki/packages/bitcoin'
import { type AsyncResult, Err, Ok, type Result } from '@hoseki/packages/result'
import { HardwareDeviceError, type SupportedHardwareWallet } from '@hoseki/packages/wallet'
import { browserLogger, captureHardwareWalletError } from '../../logger'
import type { ClaimDto, KeystoreDto } from '../../trpc/server-types'

export function getKeystoreStatus(keystore: KeystoreDto, claim: ClaimDto): 'pending' | 'identified' | 'verified' {
  const keystoreIsSigned = claim.latestChallenge?.messages.some((m) => m.keystoreId === keystore.id && m.signed)
  return keystoreIsSigned === true ? 'verified' : keystore.isIdentified ? 'identified' : 'pending'
}

type Keystore = {
  derivationPath: DerivationPathString | null
  xpub: Xpub
}

/**
 * We were previously assuming that the derivation path was the same for all keystores and
 * grabbing the first one from the list of keystores. This is not the case, so we now loop
 * through all the keystores and return the Xpub from the first keystore whose derivation path
 * and Xpub matches in the device search.
 */
export async function getXpubFrom({
  claim,
  getXpubForPath,
  deviceType,
}: {
  claim: { keystores: Keystore[] }
  getXpubForPath: (derivationPath: DerivationPath) => Result<Xpub, Error> | AsyncResult<Xpub, Error>
  deviceType: SupportedHardwareWallet
}): Promise<Result<Xpub, Error>> {
  let lastHardwareError: Error | undefined
  for (const ks of claim.keystores) {
    if (!ks.derivationPath) {
      browserLogger.debug('Keystore has no derivation path, skipping to the next keystore')
      continue
    }

    const xpubRes = await getXpubForPath(DerivationPath.from(ks.derivationPath))
    if (xpubRes.isErr()) {
      const error = xpubRes.unwrapErr()
      if (error instanceof HardwareDeviceError) {
        captureHardwareWalletError(
          error,
          'Failed to get xpub from device',
          { wallet: deviceType, step: 'multisig-xpub-check' },
          { path: ks.derivationPath },
        )
        // Hardware errors (e.g. device disconnected) are fatal — stop immediately
        return Err(error)
      }
      // Non-hardware errors (e.g. derivation path not found in export file) are expected
      // when iterating keystores that belong to other devices — skip to next keystore
      browserLogger.debug(
        { path: ks.derivationPath, error: error.message },
        'Derivation path not found on device, skipping',
      )
      lastHardwareError = error
      continue
    }

    const xpub = xpubRes.unwrap()
    if (xpub.equals(ks.xpub)) {
      return Ok(xpub)
    } else {
      browserLogger.debug('Unhardened xpub does not match keystore xpub, skipping to the next keystore')
    }
  }
  return Err(lastHardwareError ?? new Error(`No ${deviceType} account found matching any keystore xpub`))
}
