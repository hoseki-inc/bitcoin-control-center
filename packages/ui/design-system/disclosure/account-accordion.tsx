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
  Spinner,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import { Badge } from '@hoseki/packages/ui/design-system'
import { type BitcoinInput, encodingsToLabels, monoInputProps } from '../../utils/bitcoin'
import { EditButtonAddon } from '../forms/input-addons'
import { RollingBtcAmount } from '../forms/script-type-radio-group'

export type BalanceData =
  | {
      noBalance: string
      btc: null
      usd: null
      isScanning?: boolean
    }
  | {
      noBalance: null
      btc: string
      usd: string
      isScanning?: boolean
      balanceSats?: bigint
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
                {balance.noBalance !== null ? (
                  <Box as="span" display="inline-flex" alignItems="center" gap={1.5}>
                    {balance.isScanning === true && (
                      <Spinner aria-hidden="true" label="" size="xs" color="neutral.600" emptyColor="neutral.200" />
                    )}
                    <Text as="span" color="neutral.600">
                      {balance.noBalance}
                    </Text>
                  </Box>
                ) : (
                  <Box as="span" display="inline-flex" alignItems="center" gap={2}>
                    {balance.isScanning === true && (
                      <>
                        <Spinner aria-hidden="true" label="" size="xs" color="success.600" emptyColor="neutral.200" />
                        <Box as="span" srOnly>
                          Scanning…
                        </Box>
                      </>
                    )}
                    <Text as="span" color="success.600" fontWeight="medium" display="inline-block">
                      {balance.usd}
                    </Text>
                    {balance.balanceSats !== undefined ? (
                      <RollingBtcAmount balanceSats={balance.balanceSats} color="neutral.600" />
                    ) : (
                      <Text as="span" color="neutral.600">
                        {balance.btc}
                      </Text>
                    )}
                  </Box>
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
