import {
  DerivationPath,
  Network,
  NetworkAccount,
  SingleSigAccount,
  type SingleSigAccountScriptType,
} from '@hoseki/packages/bitcoin'
import {
  ClaimConnectionWrapper,
  type SelectedTrezorAccount,
  TrezorConfirm,
  TrezorInfo,
  getTrezorDisplayName,
  getTrezorModel,
} from '@hoseki/packages/ui/wallet-ui'
import { DERIVATION_PATH_TO_SCRIPT_TYPE, Slip132 } from '@hoseki/packages/wallet'
import { Err, Ok, Result } from '@patina/core'
import type { Features } from '@trezor/connect-web'
import Decimal from 'decimal.js'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useNavigateToAnExistentOrNewClaim } from '../../../lib/claim-flow'
import { browserLogger } from '../../../logger'
import { trpc } from '../../../trpc'
import { RequiredDataMissing } from '../../errors/required-data-missing'
import { trezorService } from './trezor-service-singleton'

export function ConnectTrezor(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/accounts'
  const trpcUtils = trpc.useUtils()
  const [step, setStep] = useState<'step-1-info' | 'step-2-confirm'>('step-1-info')
  const [selectedTrezorAccount, setSelectedTrezorAccount] = useState<SelectedTrezorAccount>()
  const navigateToAnExistentOrNewClaim = useNavigateToAnExistentOrNewClaim()

  async function getTrezorAccountInfo(): Promise<Result<void, Error>> {
    const trezorFeaturesRes = await trezorService.getFeatures()
    const trezorAccountInfoRes = await trezorService.getAccountInfo()

    if (trezorFeaturesRes.isErr()) {
      return Err(trezorFeaturesRes.unwrapErr())
    }
    if (trezorAccountInfoRes.isErr()) {
      return Err(trezorAccountInfoRes.unwrapErr())
    }

    const trezorFeatures = trezorFeaturesRes.unwrap()
    const trezorAccountInfo = trezorAccountInfoRes.unwrap()

    // Legacy, nested Segwit, Segwit use _pub format in the descriptor field
    // While Taproot uses a real descriptor
    // For this reason, we're using the legacyXpub format if it exists, because it is more correct
    const rawInput = trezorAccountInfo.legacyXpub ?? trezorAccountInfo.descriptor

    let account: SingleSigAccount

    // Try to parse the account from the descriptor Trezor gave us
    const accountRes = SingleSigAccount.fromDescriptor(rawInput)
    if (accountRes.isOk()) {
      account = accountRes.unwrap()
    } else {
      // If we can't parse the account from the descriptor, try to parse the xpub
      const xpubResult = Slip132.getXpubFromString(rawInput)
      if (xpubResult.isErr()) {
        return Err(xpubResult.unwrapErr())
      }

      // Get default script type based on the path
      const scriptTypeResult = getScriptType(trezorAccountInfo.path)
      if (scriptTypeResult.isErr()) {
        return Err(scriptTypeResult.unwrapErr())
      }

      account = new SingleSigAccount(scriptTypeResult.unwrap(), xpubResult.unwrap())
    }

    const derivationPath = trezorAccountInfo.path
      ? DerivationPath.fromString(trezorAccountInfo.path).unwrapOr(null)
      : null

    // Set the selected Trezor account
    setSelectedTrezorAccount({
      trezorFeatures,
      trezorAccountInfo: trezorAccountInfo,
      wallet: {
        accountIndex: 1,
        rawInput,
        account,
        derivationPath,
        btcBalance: new Decimal(trezorAccountInfo.balance),
        usdBalance: null, // Initially null, fetched at the end of this function
        displayName: getTrezorDisplayName(trezorFeatures),
        label: 'Account 1',
      },
    })

    // Fire-and-forget call because balances are just not shown if they were unable to load
    getTrezorAccountBalance(account).catch(() => {
      browserLogger.warn('Unable to refresh the optional Trezor account balance')
    })
    setStep('step-2-confirm')
    return Ok()
  }

  async function getTrezorAccountBalance(account: SingleSigAccount) {
    const networkAccount = new NetworkAccount(Network.Mainnet, account)
    const balanceRes = await Result.fromPromise(
      trpcUtils.portalProve.onchain.bitcoinAccountBalances.fetch({ accounts: [networkAccount.toString()] }),
    )
    if (balanceRes.isErr()) {
      return
    }

    const balance = balanceRes.unwrap()
    const balanceValue = balance.accounts.get(networkAccount.toString())
    if (!balanceValue) {
      return
    }

    setSelectedTrezorAccount((prev) => {
      if (!prev) {
        return prev
      }
      return {
        ...prev,
        wallet: {
          ...prev.wallet,
          btcBalance: balanceValue.current,
          usdBalance: balanceValue ? balanceValue.usd : null,
        },
      }
    })
  }

  function handleContinue(trezorFeatures: Features) {
    if (!selectedTrezorAccount) {
      return
    }

    navigateToAnExistentOrNewClaim.execute({
      network: 'bitcoin_mainnet',
      account: selectedTrezorAccount.wallet.account,
      derivationPath: selectedTrezorAccount.wallet.derivationPath,
      wallet: 'trezor',
      model: getTrezorModel(trezorFeatures.internal_model),
      displayName: selectedTrezorAccount.wallet.displayName ?? 'Trezor Wallet',
    })
  }

  return (
    <ClaimConnectionWrapper>
      {step === 'step-1-info' && (
        <TrezorInfo onBack={() => navigate(returnTo)} onConnectTrezor={getTrezorAccountInfo} />
      )}

      {step === 'step-2-confirm' &&
        (!selectedTrezorAccount ? (
          <RequiredDataMissing />
        ) : (
          <TrezorConfirm
            trezorAccount={selectedTrezorAccount}
            setSelectedTrezorAccount={setSelectedTrezorAccount}
            isLoadingOnContinue={navigateToAnExistentOrNewClaim.isLoading}
            onContinue={() => {
              handleContinue(selectedTrezorAccount.trezorFeatures)
            }}
            onCancel={() => navigate(returnTo)}
          />
        ))}
    </ClaimConnectionWrapper>
  )
}

function getScriptType(path?: string): Result<SingleSigAccountScriptType, Error> {
  if (!path) {
    return Err(new Error('Derivation path was missing'))
  }
  const split = path.split('/')
  const pathStart = split[0] + '/' + split[1]
  if (pathStart && pathStart in DERIVATION_PATH_TO_SCRIPT_TYPE) {
    return Ok(DERIVATION_PATH_TO_SCRIPT_TYPE[pathStart as keyof typeof DERIVATION_PATH_TO_SCRIPT_TYPE])
  } else {
    return Err(new Error(`Invalid derivation path: ${path}`))
  }
}
