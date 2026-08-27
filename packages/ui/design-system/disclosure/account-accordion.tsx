import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  FormControl,
  FormLabel,
  HStack,
  Input,
  InputGroup,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import { Badge } from '@hoseki/packages/ui/design-system'
import { type BitcoinInput, encodingsToLabels, monoInputProps } from '../../utils/bitcoin'
import { EditButtonAddon } from '../forms/input-addons'

export type BalanceData =
  | {
      noBalance: string
      btc: null
      usd: null
    }
  | {
      noBalance: null
      btc: string
      usd: string
    }
export function AccountAccordion({
  bitcoinInput,
  balance,
  onEditClick,
}: {
  bitcoinInput: BitcoinInput
  balance: BalanceData
  onEditClick: () => void
}): JSX.Element {
  return (
    <Accordion allowToggle>
      <AccordionItem border="none">
        <h2>
          <AccordionButton py={4} px={0} border="none" _hover={{ bg: 'white' }}>
            <HStack flexGrow={1}>
              <Box as="span" flex="1" textAlign="left">
                <Text as="span" mr={3}>
                  Bitcoin Core Wallet
                </Text>
                {balance.noBalance ? (
                  <Text as="span" color="neutral.600">
                    {balance.noBalance}
                  </Text>
                ) : (
                  <>
                    <Text as="span" color="success.600" fontWeight="medium" display="inline-block" mr={2}>
                      {balance.usd}
                    </Text>
                    <Text as="span" color="neutral.600">
                      {balance.btc}
                    </Text>
                  </>
                )}
              </Box>
              <Badge ml={4}>{encodingsToLabels[bitcoinInput.data.account.scriptType]}</Badge>
            </HStack>
            <AccordionIcon />
          </AccordionButton>
        </h2>
        <AccordionPanel pb={4} px={0}>
          <Stack gap={4}>
            <FormControl>
              <FormLabel htmlFor="display-name">Display name</FormLabel>
              <Input id="display-name" type="text" value={bitcoinInput.displayName} isDisabled {...monoInputProps} />
            </FormControl>
            <FormControl>
              <FormLabel htmlFor="bitcoin-source">Account descriptor or extended public key</FormLabel>
              <InputGroup>
                <Textarea
                  id="bitcoin-source"
                  value={bitcoinInput.rawInput}
                  sx={{ resize: 'none' }}
                  isDisabled
                  {...monoInputProps}
                />
                <EditButtonAddon onClick={onEditClick} />
              </InputGroup>
            </FormControl>
          </Stack>
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  )
}
