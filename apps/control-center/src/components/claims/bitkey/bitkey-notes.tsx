import { Box, HStack, Stack, Text, chakra } from '@chakra-ui/react'
import { TipAlert } from '@hoseki/packages/ui/design-system/feedback/tip-alert'
import { type BitkeyKeyRole, bitkeyKeyLabels } from '@hoseki/packages/wallet'
import { InfoIcon, RotateCcwKeyIcon } from 'lucide-react'

export function BitkeyUnverifiedNote(): JSX.Element {
  return (
    <TipAlert title="Unverified" icon={InfoIcon}>
      <Text color="neutral.800">
        Bitkey can’t sign messages yet, so Control Center can’t confirm this wallet is yours. You’ll still see its
        balance and history. Statements only include verified accounts, so this one is left out for now.
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

export interface BitkeyKeyRow {
  role: BitkeyKeyRole
  xpub: string
}

/** Bitkey's three keys, so people can see what the account is made of. */
export function BitkeyKeyList({ keys }: { keys: BitkeyKeyRow[] }): JSX.Element {
  return (
    <Stack
      gap={0}
      borderWidth="1px"
      borderColor="neutral.200"
      borderRadius="md"
      divider={<Box borderColor="neutral.200" borderTopWidth="1px" />}
    >
      {keys.map((key) => (
        <HStack key={key.role} justify="space-between" px={4} py={3} gap={4}>
          <Text textStyle="text/sm" fontWeight="medium" color="neutral.900">
            {bitkeyKeyLabels[key.role]}
          </Text>
          <chakra.code color="neutral.600" whiteSpace="nowrap">
            {`${key.xpub.slice(0, 8)}…${key.xpub.slice(-6)}`}
          </chakra.code>
        </HStack>
      ))}
    </Stack>
  )
}
