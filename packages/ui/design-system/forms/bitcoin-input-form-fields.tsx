import { Flex, FormControl, FormLabel, Input, Stack, Text, Textarea } from '@chakra-ui/react'
import {
  type CheckedSinglesigAccountDescriptor,
  Network,
  NetworkAccount,
  SingleSigAccount,
  type SingleSigAccountScriptType,
} from '@hoseki/packages/bitcoin'
import { Slip132 } from '@hoseki/packages/wallet'
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react'
import { FormErrorMessage, LabelWithTooltip } from '..'
import { type BitcoinInput, monoInputProps } from '../../utils/bitcoin'
import { BitcoinNetworkSelect } from './bitcoin-network-select'
import { type ScriptTypeBalances, ScriptTypeRadioGroup, getUniqueFundedScriptType } from './script-type-radio-group'

export function getPrefixScriptType(btcStr: string): SingleSigAccountScriptType | null {
  const firstChar = btcStr.trim()[0]
  switch (firstChar) {
    case 'y':
    case 'u':
      return 'p2sh-p2wpkh'
    case 'z':
    case 'v':
      return 'p2wpkh'
    case undefined:
    default:
      return null
  }
}

function getNetwork(descriptor?: CheckedSinglesigAccountDescriptor): Network {
  if (!descriptor) {
    return Network.Mainnet
  }
  const network = SingleSigAccount.fromCheckedDescriptor(descriptor).network()

  // Flip default testnet to regtest since it's more common for development
  if (network.kind === 'Testnet') {
    return Network.Regtest
  }

  return network
}

// NOTE: This is just the fields for the form, not the <form> itself.
// Reason is that the design places the submit buttons in a weird place (fixed at the bottom).
export function BitcoinInputFormFields({
  setBitcoinInput,
  defaultValues,
  scriptTypeBalances,
  onRawInputChange,
}: {
  setBitcoinInput: Dispatch<SetStateAction<BitcoinInput | null>>
  defaultValues?: BitcoinInput
  scriptTypeBalances?: ScriptTypeBalances
  onRawInputChange?: (raw: string) => void
}): JSX.Element {
  const [bitcoinRaw, setBitcoinRaw] = useState<string>(defaultValues?.rawInput ?? '')
  const [displayName, setDisplayName] = useState<string>(defaultValues?.displayName ?? '')
  const [pickedScriptType, setPickedScriptType] = useState<SingleSigAccountScriptType | null>(null)

  const trimmedBitcoinRaw = bitcoinRaw.trim()
  // Keep parsed values stable when publishing the input causes a parent render.
  const xpub = useMemo(() => Slip132.getXpubFromString(trimmedBitcoinRaw), [trimmedBitcoinRaw])

  const bitcoinRawDescriptorInput = trimmedBitcoinRaw.split(/[\n\s]+/)[0] ?? trimmedBitcoinRaw
  const singleSigAccount = useMemo(
    () => SingleSigAccount.fromDescriptor(bitcoinRawDescriptorInput),
    [bitcoinRawDescriptorInput],
  )
  const descriptor = singleSigAccount.unwrapOr(null)?.descriptor()

  const showEncodingInput = xpub.match({
    Ok: () => trimmedBitcoinRaw.startsWith('x'),
    Err: () => false,
  })

  const presetScriptType =
    defaultValues?.rawInput.trim() === trimmedBitcoinRaw ? defaultValues.data.account.scriptType : null
  const suggestedScriptType = showEncodingInput ? getUniqueFundedScriptType(scriptTypeBalances) : null
  const effectiveScriptType: SingleSigAccountScriptType | null = showEncodingInput
    ? (pickedScriptType ?? presetScriptType ?? suggestedScriptType)
    : (presetScriptType ?? getPrefixScriptType(trimmedBitcoinRaw) ?? 'p2pkh')

  const isScanningBalances =
    showEncodingInput &&
    scriptTypeBalances !== undefined &&
    Object.values(scriptTypeBalances).some((entry) => entry.status === 'loading')

  const showNetworkInput = singleSigAccount.match({
    Ok: (acc) => acc.network().kind !== 'Mainnet',
    Err: () => false,
  })
  const [network, setNetwork] = useState<Network>(Network.Mainnet)
  useEffect(() => {
    setNetwork(showNetworkInput ? getNetwork(descriptor) : Network.Mainnet)
  }, [showNetworkInput, descriptor])

  useEffect(() => {
    if (!trimmedBitcoinRaw) {
      setBitcoinInput(null)
      return
    }

    let input: BitcoinInput
    if (xpub.isOk()) {
      const parsedXpub = xpub.unwrap()
      if (effectiveScriptType === null) {
        setBitcoinInput(null)
        return
      }
      input = {
        variant: 'singlesig',
        data: new NetworkAccount(network, new SingleSigAccount(effectiveScriptType, parsedXpub)),
        rawInput: trimmedBitcoinRaw,
        displayName,
      }
    } else if (singleSigAccount.isOk()) {
      input = {
        variant: 'singlesig',
        data: new NetworkAccount(network, singleSigAccount.unwrap()),
        rawInput: trimmedBitcoinRaw,
        displayName,
      }
    } else {
      setBitcoinInput(null)
      return
    }

    setBitcoinInput(input)
  }, [trimmedBitcoinRaw, displayName, effectiveScriptType, network, setBitcoinInput, xpub, singleSigAccount])

  const isInvalid = trimmedBitcoinRaw !== '' && xpub.isErr() && singleSigAccount.isErr()

  return (
    <Stack gap={4}>
      <FormControl>
        <FormLabel htmlFor="display-name">Display name</FormLabel>
        <Input
          id="display-name"
          type="text"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value)
          }}
          placeholder="Give this account a name"
          isRequired
          maxLength={255}
        />
      </FormControl>

      <FormControl isInvalid={isInvalid}>
        <FormLabel htmlFor="bitcoin-source">Account descriptor or extended public key</FormLabel>
        <Textarea
          id="bitcoin-source"
          rows={3}
          value={bitcoinRaw}
          onChange={(e) => {
            const nextRaw = e.target.value
            setBitcoinRaw(nextRaw)
            if (nextRaw.trim() !== bitcoinRaw.trim()) {
              setPickedScriptType(null)
            }
            onRawInputChange?.(nextRaw)
          }}
          placeholder="Account descriptor or extended public key"
          sx={{ resize: 'none' }}
          isRequired
          {...monoInputProps}
        />
        {!isInvalid && xpub.isOk() && (
          <Text textStyle="label/sm" color="neutral.500" mt={1}>
            Account descriptors are preferred over extended public keys because they include the script type.
          </Text>
        )}
        {isInvalid && <FormErrorMessage>Invalid input, please enter a valid xPub/yPub/zPub key</FormErrorMessage>}
      </FormControl>

      {showEncodingInput && (
        <FormControl>
          <Flex align="center" justify="space-between" gap={2}>
            <LabelWithTooltip
              htmlFor="encoding"
              labelText="Select script type"
              tooltipText="Not sure? Pick one and check the balance. If it's wrong, abandon it and try another."
            />
            {isScanningBalances && (
              <Text textStyle="label/xs" color="neutral.500" mb={2}>
                Checking Electrum…
              </Text>
            )}
          </Flex>
          <ScriptTypeRadioGroup
            name="encoding"
            value={effectiveScriptType}
            onChange={setPickedScriptType}
            balances={scriptTypeBalances}
          />
        </FormControl>
      )}

      {showNetworkInput && (
        <FormControl>
          <FormLabel htmlFor="network">Network</FormLabel>
          <BitcoinNetworkSelect value={network} onChange={setNetwork} />
        </FormControl>
      )}
    </Stack>
  )
}
