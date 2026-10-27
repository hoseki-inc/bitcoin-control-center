import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Input,
  InputGroup,
  Stack,
  Text,
  chakra,
} from '@chakra-ui/react'
import { TipAlert } from '@hoseki/packages/ui/design-system/feedback/tip-alert'
import { CopyButtonAddon } from '@hoseki/packages/ui/design-system/forms/input-addons'
import { monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { type BitkeyKeyRole, bitkeyKeyLabels } from '@hoseki/packages/wallet'
import type { ReactNode } from 'react'
import { BitkeyPhoneThumbnail } from './bitkey-phone-steps'

export function BitkeyUnverifiedNote({ isBrief = false }: { isBrief?: boolean }): JSX.Element {
  return (
    <TipAlert title="Unverified">
      <Text color="neutral.800">
        {isBrief
          ? 'Its balance and history update as usual. Bitkey can’t sign messages yet, so statements leave this account out.'
          : 'Bitkey can’t sign messages yet, so Control Center can’t confirm this wallet is yours. You’ll still see its balance and history. Statements only include verified accounts, so this one is left out for now.'}
      </Text>
    </TipAlert>
  )
}

export function BitkeyRecoveryNote(): JSX.Element {
  return (
    <TipAlert title="Recovered your Bitkey?">
      <Text color="neutral.800">
        A Bitkey recovery moves your bitcoin to new keys, so this account stops updating. Export the wallet descriptor
        again and add it as a new Bitkey.
      </Text>
    </TipAlert>
  )
}

const keyDetails = {
  app: { picture: <BitkeyPhoneThumbnail height={38} />, description: 'In the Bitkey app on your phone' },
  hardware: {
    picture: <chakra.img src="/images/hardware-wallets/bitkey-device.png" alt="" h="32px" />,
    description: 'On your Bitkey, unlocked by your fingerprint',
  },
  server: {
    picture: <chakra.img src="/images/hardware-wallets/block-logo-mini.svg" alt="" boxSize="20px" />,
    description: 'Held by Block, to help you recover if you lose your phone or Bitkey',
  },
} as const satisfies Record<BitkeyKeyRole, { picture: ReactNode; description: string }>

export interface BitkeyKeyRow {
  role: BitkeyKeyRole
  xpub: string
  derivationPath: string | null
}

/** Bitkey's three keys: where each one lives, and its public key when opened. */
export function BitkeyKeyList({ keys }: { keys: BitkeyKeyRow[] }): JSX.Element {
  return (
    <Accordion allowMultiple borderWidth="1px" borderColor="neutral.200" borderRadius="md" overflow="hidden">
      {keys.map(({ role, xpub, derivationPath }) => {
        const { picture, description } = keyDetails[role]
        const label = bitkeyKeyLabels[role]
        return (
          <AccordionItem
            key={role}
            // The theme draws each item as its own card; here the three keys share one, split by dividers.
            px={0}
            border="none"
            borderRadius={0}
            _notFirst={{ borderTop: '1px solid', borderColor: 'neutral.200' }}
          >
            <h3>
              <AccordionButton px={4} py={3} gap={3} textAlign="left" _hover={{ bgColor: 'neutral.50' }}>
                <Box flexShrink={0} boxSize={12} display="grid" placeItems="center">
                  {picture}
                </Box>
                <Box flex={1}>
                  <Text textStyle="text/sm" fontWeight="medium" color="neutral.900">
                    {label}
                  </Text>
                  <Text textStyle="text/sm" color="neutral.600">
                    {description}
                  </Text>
                </Box>
                <AccordionIcon color="neutral.500" />
              </AccordionButton>
            </h3>
            {/* Lines up with the text: 16 px padding, the 48 px picture and the 12 px gap. */}
            <AccordionPanel pl="76px" pr={4} pt={0} pb={4}>
              <Stack spacing={3}>
                <Box>
                  <Text textStyle="text/xs" color="neutral.600" mb={1}>
                    Public key
                  </Text>
                  <InputGroup>
                    <Input value={xpub} isReadOnly aria-label={`${label} public key`} {...monoInputProps} />
                    <CopyButtonAddon fieldName="public key" value={xpub} />
                  </InputGroup>
                </Box>
                {derivationPath !== null && (
                  <Box>
                    <Text textStyle="text/xs" color="neutral.600" mb={1}>
                      Derivation path
                    </Text>
                    <Text textStyle="text/sm" color="neutral.900" fontFamily="mono">
                      {derivationPath}
                    </Text>
                  </Box>
                )}
              </Stack>
            </AccordionPanel>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}
