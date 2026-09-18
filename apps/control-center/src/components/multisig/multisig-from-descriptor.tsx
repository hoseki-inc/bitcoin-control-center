import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Button,
  Flex,
  FormControl,
  FormErrorMessage,
  Text,
  Textarea,
} from '@chakra-ui/react'
import { MultiSigAccount } from '@hoseki/packages/bitcoin'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import { monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { WalletImporter } from '@hoseki/packages/wallet'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { CreateMultisigClaimInput, CreateMultisigKeystoreInput } from '../../trpc/server-types'

function createMultisigClaimInputFromDescriptor(
  descriptor: string,
  displayName: string,
): Result<CreateMultisigClaimInput, Error> {
  const multisigWalletResult = WalletImporter.multisigFromDescriptor(descriptor)
  if (multisigWalletResult.isErr()) {
    return Err(new Error(`Invalid descriptor: ${multisigWalletResult.unwrapErr()?.message}`))
  }

  const multisigWallet = multisigWalletResult.unwrap()

  const keystores: CreateMultisigKeystoreInput[] = []
  for (const keyExpression of multisigWallet.keyExpressions) {
    const derivationPath = keyExpression.keyOrigin?.derivationPath?.toString() ?? null
    keystores.push({
      label: 'Key',
      derivationPath,
      publicKey: keyExpression.xpub.toString(),
      wallet: null,
      model: null,
    })
  }

  const account = MultiSigAccount.fromWallet(multisigWallet)

  return Ok({
    displayName,
    account: account.descriptor(),
    network: 'bitcoin_mainnet',
    keystores,
  })
}

export function MultisigFromDescriptor({ onNext }: { onNext: (data: CreateMultisigClaimInput) => void }): JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    setError,
  } = useForm({
    defaultValues: {
      descriptor: '',
    },
    mode: 'onChange',
    reValidateMode: 'onChange',
  })

  const [parsingError, setParsingError] = useState<string | null>(null)

  function validateDescriptor(value: string) {
    if (!value) {
      return 'Descriptor is required'
    }

    try {
      const parsed = WalletImporter.multisigFromDescriptor(value)
      if (parsed.isOk()) {
        setParsingError(null)
        return true
      } else {
        const parseErrorMessage = `Invalid descriptor: ${parsed.unwrapErr()?.message}`
        setParsingError(parseErrorMessage)
        return parseErrorMessage
      }
    } catch {
      setParsingError('Invalid descriptor')
      return 'Invalid descriptor'
    }
  }

  function onSubmit(data: { descriptor: string }) {
    const walletResult = createMultisigClaimInputFromDescriptor(data.descriptor, '')
    if (walletResult.isOk()) {
      setParsingError(null)
      onNext(walletResult.unwrap())
    } else {
      const errorMsg = walletResult.unwrapErr()?.message
      setParsingError(`Invalid descriptor: ${errorMsg}`)
      setError('descriptor', { type: 'manual', message: `Invalid descriptor: ${errorMsg}` })
    }
  }

  return (
    <Accordion allowMultiple border="solid 1px" borderColor="neutral.200" borderRadius="4px">
      <AccordionItem border="none">
        <h2>
          <AccordionButton p={4} _hover={{ bgColor: 'inherit' }}>
            <Text flex="1" as="h3" textStyle="text/sm" color="neutral.600" fontWeight={500} textAlign="left">
              Paste Your Multisig Descriptor
            </Text>
            <AccordionIcon />
          </AccordionButton>
        </h2>
        <AccordionPanel p={4} pt={0} display="flex" flexDirection="column" gap={4}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <FormControl mb={4} isInvalid={!!errors.descriptor || !!parsingError}>
              <Textarea
                {...register('descriptor', {
                  required: 'Descriptor is required',
                  validate: validateDescriptor,
                })}
                placeholder="Example: wsh(sortedmulti(2,[fingerprint/derivation]xpub...))"
                rows={10}
                {...monoInputProps}
              />
              <FormErrorMessage>{errors.descriptor?.message || parsingError}</FormErrorMessage>
            </FormControl>
            <Flex justifyContent="flex-end">
              <Button type="submit" isDisabled={!isValid} size="sm" variant="outline">
                Verify Descriptor
              </Button>
            </Flex>
          </form>
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  )
}
