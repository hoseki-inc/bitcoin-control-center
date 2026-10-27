import { Box, HStack, Input, InputGroup, Stack, StackDivider, Text, chakra } from '@chakra-ui/react'
import { TipAlert } from '@hoseki/packages/ui/design-system/feedback/tip-alert'
import { CopyButtonAddon } from '@hoseki/packages/ui/design-system/forms/input-addons'
import { monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { type BitkeyKeyRole, bitkeyKeyLabels } from '@hoseki/packages/wallet'
import { InfoIcon, RotateCcwKeyIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { BitkeyPhoneThumbnail } from './bitkey-phone-steps'

export function BitkeyUnverifiedNote({ isBrief = false }: { isBrief?: boolean }): JSX.Element {
  return (
    <TipAlert title="Unverified" icon={InfoIcon}>
      <Text color="neutral.800">
        {isBrief
          ? 'Bitkey can’t sign messages yet, so statements leave this account out.'
          : 'Bitkey can’t sign messages yet, so Control Center can’t confirm this wallet is yours. You’ll still see its balance and history. Statements only include verified accounts, so this one is left out for now.'}
      </Text>
    </TipAlert>
  )
}

export function BitkeyRecoveryNote(): JSX.Element {
  return (
    <TipAlert title="Recovered your Bitkey?" icon={RotateCcwKeyIcon}>
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
}

/** Bitkey's three keys: where each one lives and, when asked, its public key. */
export function BitkeyKeyList({
  keys,
  showPublicKeys = false,
}: {
  keys: BitkeyKeyRow[]
  showPublicKeys?: boolean
}): JSX.Element {
  return (
    <Stack
      spacing={0}
      borderWidth="1px"
      borderColor="neutral.200"
      borderRadius="md"
      divider={<StackDivider borderColor="neutral.200" />}
    >
      {keys.map(({ role, xpub }) => {
        const { picture, description } = keyDetails[role]
        const label = bitkeyKeyLabels[role]
        return (
          <Stack key={role} spacing={3} px={4} py={3}>
            <HStack spacing={3}>
              <Box flexShrink={0} boxSize={12} borderRadius="md" bg="neutral.100" display="grid" placeItems="center">
                {picture}
              </Box>
              <Box>
                <Text textStyle="text/sm" fontWeight="medium" color="neutral.900">
                  {label}
                </Text>
                <Text textStyle="text/sm" color="neutral.600">
                  {description}
                </Text>
              </Box>
            </HStack>
            {/* Lines up with the text: the 48 px picture plus the 12 px gap. */}
            {showPublicKeys && (
              <InputGroup pl="60px">
                <Input value={xpub} isReadOnly aria-label={`${label} public key`} {...monoInputProps} />
                <CopyButtonAddon fieldName="public key" value={xpub} />
              </InputGroup>
            )}
          </Stack>
        )
      })}
    </Stack>
  )
}
