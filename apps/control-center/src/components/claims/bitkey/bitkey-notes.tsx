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
  Tooltip,
  chakra,
} from '@chakra-ui/react'
import { CopyButtonAddon } from '@hoseki/packages/ui/design-system/forms/input-addons'
import { monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { type BitkeyKeyRole, bitkeyKeyLabels } from '@hoseki/packages/wallet'
import type { ReactNode } from 'react'
import { BitkeyPhoneThumbnail } from './bitkey-phone-steps'

/** Why a Bitkey stays Unverified: in its note in the connect flow and in the tooltip on its badge. */
const bitkeyUnverifiedReason =
  'Bitkey doesn’t support proving ownership of its individual keys, so Control Center can’t verify this wallet is yours. You can still track its balance and history, but your Bitkey won’t be included in statements.'

/**
 * A light note on an Unverified badge or count. It opens beside it, so it doesn't cover the account it explains,
 * and above it when there's no room.
 */
export function UnverifiedTooltip({
  label = bitkeyUnverifiedReason,
  isDisabled = false,
  children,
}: {
  label?: string
  isDisabled?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <Tooltip
      label={label}
      isDisabled={isDisabled}
      placement="right"
      modifiers={[{ name: 'flip', options: { fallbackPlacements: ['top'] } }]}
      openDelay={250}
      hasArrow
      maxW="20rem"
      px={3}
      py={2}
      textStyle="text/sm"
      fontWeight="normal"
      color="neutral.700"
      boxShadow="md"
    >
      {children}
    </Tooltip>
  )
}

/** Drawn like an Unverified account on Portfolio: a gray outline with the Unverified pill on its top edge. */
export function BitkeyUnverifiedNote(): JSX.Element {
  return (
    <Box
      position="relative"
      mt={2}
      px={4}
      pt={4}
      pb={3}
      border="1px solid"
      borderColor="neutral.400"
      borderRadius="control"
    >
      <Text
        as="span"
        position="absolute"
        top="-9px"
        left="50%"
        transform="translateX(-50%)"
        px={2}
        bg="neutral.50"
        border="1px solid"
        borderColor="neutral.400"
        borderRadius="full"
        whiteSpace="nowrap"
        textStyle="label/xs"
        fontWeight="semibold"
        color="neutral.600"
      >
        Unverified
      </Text>
      <Text textStyle="text/md" color="neutral.800">
        {bitkeyUnverifiedReason}
      </Text>
    </Box>
  )
}

/** What to do after a Bitkey recovery, as a question that opens like an FAQ. Sized like the key rows above it. */
export function BitkeyRecoveryQuestion(): JSX.Element {
  return (
    <Accordion allowToggle>
      <AccordionItem>
        <h2>
          <AccordionButton>
            <Text as="span" textStyle="text/sm" fontWeight="medium" color="neutral.900">
              Recovered your Bitkey?
            </Text>
            <AccordionIcon color="neutral.500" />
          </AccordionButton>
        </h2>
        <AccordionPanel>
          <Text textStyle="text/sm" color="neutral.600">
            A Bitkey recovery moves your bitcoin to new keys, so this account stops updating. Export the wallet
            descriptor again and add it as a new Bitkey.
          </Text>
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
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
