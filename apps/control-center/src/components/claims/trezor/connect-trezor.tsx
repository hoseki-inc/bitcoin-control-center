import {
  DerivationPath,
  Network,
  NetworkAccount,
  SingleSigAccount,
  type SingleSigAccountScriptType,
} from '@hoseki/packages/bitcoin'
import { Err, Ok, Result } from '@hoseki/packages/result'
import {
  ClaimConnectionWrapper,
  type SelectedTrezorAccount,
  TrezorConfirm,
  TrezorInfo,
  getTrezorDisplayName,
  getTrezorModel,
} from '@hoseki/packages/ui/wallet-ui'
import { DERIVATION_PATH_TO_SCRIPT_TYPE, Slip132 } from '@hoseki/packages/wallet'
import type { Features } from '@trezor/connect-web'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useNavigateToAnExistentOrNewClaim } from '../../../lib/claim-flow'
import { parseNavigationState } from '../../../lib/navigation-state'
import { browserLogger } from '../../../logger'
import { trpc } from '../../../trpc'
import { RequiredDataMissing } from '../../errors/required-data-missing'
import { trezorService } from './trezor-service-singleton'

export function ConnectTrezor(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'
  const trpcUtils = trpc.useUtils()
  const [step, setStep] = useState<'step-1-info' | 'step-2-account' | 'step-3-confirm'>('step-1-info')
  const [trezorFeatures, setTrezorFeatures] = useState<Features>()
  const [selectedTrezorAccount, setSelectedTrezorAccount] = useState<SelectedTrezorAccount>()
  const navigateToAnExistentOrNewClaim = useNavigateToAnExistentOrNewClaim()

  async function getTrezorDeviceInfo(): Promise<Result<void, Error>> {
    const result = await trezorService.getFeatures()
    setTrezorFeatures(result.unwrapOr(undefined))
    setStep('step-2-account')
    return Ok()
  }

  async function getTrezorAccountInfo(): Promise<Result<void, Error>> {
    // One Trezor call per click: Suite Web opens a popup per call, and a second popup would be blocked
    const trezorAccountRes = await trezorService.selectBitcoinAccount()
    if (trezorAccountRes.isErr()) {
      return Err(trezorAccountRes.unwrapErr())
    }

    const trezorAccount = trezorAccountRes.unwrap()
    if (trezorAccount.xpub === undefined) {
      return Err(new Error("Trezor Suite did not return the account's extended public key."))
    }

    const rawInput = trezorAccount.xpub
    const xpubResult = Slip132.getXpubFromString(rawInput)
    if (xpubResult.isErr()) {
      return Err(xpubResult.unwrapErr())
    }

    // The script type comes from the account's derivation path
    const scriptTypeResult = getScriptType(trezorAccount.path)
    if (scriptTypeResult.isErr()) {
      return Err(scriptTypeResult.unwrapErr())
    }

    const account = new SingleSigAccount(scriptTypeResult.unwrap(), xpubResult.unwrap())

    const derivationPath = DerivationPath.fromString(trezorAccount.path).unwrapOr(null)

    // Set the selected Trezor account
    setSelectedTrezorAccount({
      trezorFeatures,
      wallet: {
        accountIndex: 1,
        rawInput,
        account,
        derivationPath,
        btcBalance: 'loading',
        usdBalance: null, // Initially null, fetched at the end of this function
        displayName: trezorFeatures == null ? 'Trezor' : getTrezorDisplayName(trezorFeatures),
        label: 'Account 1',
      },
    })

    // Fire-and-forget call: the card shows the balance as unavailable if it can't be loaded
    void getTrezorAccountBalance(account)
    setStep('step-3-confirm')
    return Ok()
  }

  async function getTrezorAccountBalance(account: SingleSigAccount) {
    const networkAccount = new NetworkAccount(Network.Mainnet, account)
    const balanceRes = await Result.fromPromise(
      trpcUtils.portalProve.onchain.bitcoinAccountBalances.fetch({ accounts: [networkAccount.toString()] }),
    )
    const balanceValue = balanceRes.isOk() ? balanceRes.unwrap().accounts.get(networkAccount.toString()) : undefined
    if (!balanceValue) {
      browserLogger.warn('Unable to load the Trezor account balance')
    }

    setSelectedTrezorAccount((prev) => {
      if (!prev) {
        return prev
      }
      return {
        ...prev,
        wallet: {
          ...prev.wallet,
          btcBalance: balanceValue?.current ?? 'unavailable',
          usdBalance: balanceValue?.usd ?? null,
        },
      }
    })
  }

  function handleContinue() {
    if (!selectedTrezorAccount) {
      return
    }

    navigateToAnExistentOrNewClaim.execute({
      network: 'bitcoin_mainnet',
      account: selectedTrezorAccount.wallet.account,
      derivationPath: selectedTrezorAccount.wallet.derivationPath,
      wallet: 'trezor',
      // The device details were read in a separate Trezor Suite request
      model: getTrezorModel(selectedTrezorAccount.trezorFeatures?.internal_model),
      displayName: selectedTrezorAccount.wallet.displayName,
    })
  }

  return (
    <ClaimConnectionWrapper>
      {step === 'step-1-info' && (
        <TrezorInfo
          key="device-details"
          step="device-details"
          onBack={() => {
            void navigate(returnTo)
          }}
          onConnectTrezor={getTrezorDeviceInfo}
        />
      )}

      {step === 'step-2-account' && (
        <TrezorInfo
          key="account-selection"
          onBack={() => {
            setStep('step-1-info')
          }}
          onConnectTrezor={getTrezorAccountInfo}
        />
      )}

      {step === 'step-3-confirm' &&
        (!selectedTrezorAccount ? (
          <RequiredDataMissing />
        ) : (
          <TrezorConfirm
            trezorAccount={selectedTrezorAccount}
            setSelectedTrezorAccount={setSelectedTrezorAccount}
            isLoadingOnContinue={navigateToAnExistentOrNewClaim.isLoading}
            onContinue={handleContinue}
            onCancel={() => {
              void navigate(returnTo)
            }}
          />
        ))}
    </ClaimConnectionWrapper>
  )
}

function getScriptType(path?: string): Result<SingleSigAccountScriptType, Error> {
  if (path == null || path === '') {
    return Err(new Error('Derivation path was missing'))
  }
  const split = path.split('/')
  const pathStart = split[0] + '/' + split[1]
  const script = Object.entries(DERIVATION_PATH_TO_SCRIPT_TYPE).find(([key]) => key === pathStart)
  if (script) {
    return Ok(script[1])
  } else {
    return Err(new Error(`Invalid derivation path: ${path}`))
  }
}
