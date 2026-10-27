import { Box, HStack, Icon, Input, InputGroup, Stack, StackDivider, Text } from '@chakra-ui/react'
import { TipAlert } from '@hoseki/packages/ui/design-system/feedback/tip-alert'
import { CopyButtonAddon } from '@hoseki/packages/ui/design-system/forms/input-addons'
import { monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { type BitkeyKeyRole, bitkeyKeyLabels } from '@hoseki/packages/wallet'
import { CloudIcon, HexagonIcon, InfoIcon, type LucideIcon, RotateCcwKeyIcon, SmartphoneIcon } from 'lucide-react'

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
  app: { icon: SmartphoneIcon, description: 'In the Bitkey app on your phone' },
  hardware: { icon: HexagonIcon, description: 'On your Bitkey, unlocked by your fingerprint' },
  server: { icon: CloudIcon, description: 'Held by Block, to help you recover if you lose your phone or Bitkey' },
} as const satisfies Record<BitkeyKeyRole, { icon: LucideIcon; description: string }>

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
        const { icon, description } = keyDetails[role]
        const label = bitkeyKeyLabels[role]
        return (
          <Stack key={role} spacing={3} px={4} py={3}>
            <HStack spacing={3}>
              <Box flexShrink={0} boxSize={9} borderRadius="md" bg="neutral.100" display="grid" placeItems="center">
                <Icon as={icon} boxSize={4} color="neutral.600" />
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
            {showPublicKeys && (
              <InputGroup pl={12}>
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
