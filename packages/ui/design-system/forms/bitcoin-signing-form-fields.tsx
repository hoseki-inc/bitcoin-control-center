import { FormControl, Input, InputGroup, Textarea } from '@chakra-ui/react'
import type { Address } from '@hoseki/packages/bitcoin'
import { type Dispatch, type SetStateAction, useState } from 'react'
import { ErrorBanner, FormErrorMessage, LabelWithTooltip } from '..'
import { monoInputProps } from '../../utils/bitcoin'
import { CopyButtonAddon } from './input-addons'

// NOTE: This is just the fields for the form, not the <form> itself.
// Reason is that the design places the submit buttons in a weird place (fixed at the bottom).
export function BitcoinSigningFormFields({
  message,
  address,
  setSignature,
}: {
  message: string
  address: Address
  setSignature: Dispatch<SetStateAction<string | null>>
}): JSX.Element {
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      {error != null && error !== '' && <ErrorBanner mb={4} message={error} />}

      <FormControl>
        <LabelWithTooltip
          htmlFor="address"
          labelText="Address"
          tooltipText="A signed message requires an address (which acts as the public key) to verify which private key created it. We use the first receive address for this verification."
        />
        <InputGroup>
          <Input id="address" value={address.toString()} pr={0} isDisabled {...monoInputProps} />
          <CopyButtonAddon fieldName="address" value={address.toString()} />
        </InputGroup>
      </FormControl>

      <FormControl>
        <LabelWithTooltip
          htmlFor="message"
          labelText="Message"
          tooltipText="A unique message you'll sign to prove control of your private key."
        />
        <InputGroup>
          <Input id="message" value={message} pr={0} isDisabled {...monoInputProps} />
          <CopyButtonAddon fieldName="message" value={message} />
        </InputGroup>
      </FormControl>

      <FormControl>
        <LabelWithTooltip
          htmlFor="signature"
          labelText="Signature"
          tooltipText="The signature is the result of signing the message. It can be verified using the address to prove it was signed with the matching private key."
        />
        <Textarea
          id="signature"
          onChange={(e) => {
            if (e.target.value) {
              setSignature(e.target.value)
              setError(null)
            } else {
              setSignature(null)
              setError('Signature is required')
            }
          }}
          rows={2}
          placeholder="Enter your signed message output"
          {...monoInputProps}
        />
        {error != null && error !== '' && (
          <FormErrorMessage>Invalid input, please enter a valid xPub/yPub/zPub key</FormErrorMessage>
        )}
      </FormControl>
    </>
  )
}
