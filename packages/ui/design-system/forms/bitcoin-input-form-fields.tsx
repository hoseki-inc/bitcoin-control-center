import { FormControl, FormLabel, Input, Stack, Text, Textarea } from '@chakra-ui/react'
import {
  type CheckedSinglesigAccountDescriptor,
  Network,
  NetworkAccount,
  SingleSigAccount,
  type SingleSigAccountScriptType,
} from '@hoseki/packages/bitcoin'
import { getRecordValue } from '@hoseki/packages/lib'
import { Slip132 } from '@hoseki/packages/wallet'
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react'
import { ErrorBanner, FormErrorMessage, LabelWithTooltip, RadioCardGroup } from '..'
import { type BitcoinInput, encodingsToLabels, labelsToEncodings, monoInputProps } from '../../utils/bitcoin'
import { BitcoinNetworkSelect } from './bitcoin-network-select'

function getDefaultEncoding(btcStr: string) {
  const firstChar = btcStr[0]
  switch (firstChar) {
    case 'y':
    case 'u':
      return 'p2sh-p2wpkh'
    case 'z':
    case 'v':
      return 'p2wpkh'
    case undefined:
    default:
      return 'p2pkh'
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
}: {
  setBitcoinInput: Dispatch<SetStateAction<BitcoinInput | null>>
  defaultValues?: BitcoinInput
}): JSX.Element {
  const [bitcoinRaw, setBitcoinRaw] = useState<string>(defaultValues?.rawInput ?? '')
  const [displayName, setDisplayName] = useState<string>(defaultValues?.displayName ?? '')

  // Keep parsed values stable when publishing the input causes a parent render.
  const xpub = useMemo(() => Slip132.getXpubFromString(bitcoinRaw), [bitcoinRaw])

  const bitcoinRawDescriptorInput = bitcoinRaw.split(/[\n\s]+/)[0]?.trim() ?? bitcoinRaw
  const singleSigAccount = useMemo(
    () => SingleSigAccount.fromDescriptor(bitcoinRawDescriptorInput),
    [bitcoinRawDescriptorInput],
  )
  const descriptor = singleSigAccount.unwrapOr(null)?.descriptor()

  // Encoding/script-type input should only be shown if x-prefixed xpub
  const showEncodingInput = xpub.match({
    Ok: () => bitcoinRaw.startsWith('x'),
    Err: () => false,
  })
  const preSelectedScriptType = defaultValues?.data.account.scriptType
  const [encoding, setEncoding] = useState<SingleSigAccountScriptType | null>(preSelectedScriptType ?? null)
  useEffect(() => {
    setEncoding(showEncodingInput ? (preSelectedScriptType ?? 'p2pkh') : null)
  }, [showEncodingInput, preSelectedScriptType])

  // Show network input if not on Mainnet
  const showNetworkInput = singleSigAccount.match({
    Ok: (acc) => acc.network().kind !== 'Mainnet',
    Err: () => false,
  })
  const [network, setNetwork] = useState<Network>(Network.Mainnet)
  useEffect(() => {
    setNetwork(showNetworkInput ? getNetwork(descriptor) : Network.Mainnet)
  }, [showNetworkInput, descriptor])

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bitcoinRaw) {
      return
    }

    let input: BitcoinInput
    if (xpub.isOk()) {
      const parsedXpub = xpub.unwrap()

      // If encoding is shown, it means the user has entered an xPub, so encoding is required
      if (showEncodingInput && !encoding) {
        setBitcoinInput(null)
        setError('Encoding is required for ambiguous single-sig accounts')
        return
      }
      input = {
        variant: 'singlesig',
        data: new NetworkAccount(network, new SingleSigAccount(encoding ?? getDefaultEncoding(bitcoinRaw), parsedXpub)),
        rawInput: bitcoinRaw,
        displayName,
      }
    } else if (singleSigAccount.isOk()) {
      input = {
        variant: 'singlesig',
        data: new NetworkAccount(network, singleSigAccount.unwrap()),
        rawInput: bitcoinRaw,
        displayName,
      }
    } else {
      // Validation is displayed in the UI at this point
      setError(null)
      setBitcoinInput(null)
      return
    }

    setError(null)
    setBitcoinInput(input)
  }, [bitcoinRaw, displayName, encoding, network, showEncodingInput, setBitcoinInput, xpub, singleSigAccount])

  const isInvalid = bitcoinRaw !== '' && xpub.isErr() && singleSigAccount.isErr()

  return (
    <Stack gap={4}>
      {error != null && error !== '' && <ErrorBanner mb={4} message={error} />}

      <FormControl>
        <FormLabel htmlFor="display-name">Display name</FormLabel>
        <Input
          id="display-name"
          type="text"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value)
          }}
          placeholder="Give this claim a name"
          isRequired
          maxLength={255}
          {...monoInputProps}
        />
      </FormControl>

      <FormControl isInvalid={isInvalid}>
        <FormLabel htmlFor="bitcoin-source">Account descriptor or extended public key</FormLabel>
        <Textarea
          id="bitcoin-source"
          rows={3}
          value={bitcoinRaw}
          onChange={(e) => {
            setBitcoinRaw(e.target.value)
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
          <LabelWithTooltip
            htmlFor="encoding"
            labelText="Select script type"
            tooltipText="Select your address's script type. If you're unsure, add it and check the balance. If it doesn't match what you expect, you can go back and edit the script type."
          />
          <RadioCardGroup
            options={Object.keys(labelsToEncodings)}
            name="encoding"
            defaultValue={encodingsToLabels[encoding ?? getDefaultEncoding(bitcoinRaw)]}
            onChange={(label: string) => {
              setEncoding(getRecordValue(labelsToEncodings, label) ?? 'p2pkh')
            }}
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
