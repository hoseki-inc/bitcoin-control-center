import { HStack, Stack, Text } from '@chakra-ui/react'
import { ShieldCheckIcon } from 'lucide-react'

export function AdvancedFeatureAlert(): JSX.Element {
  return (
    <Stack px={6} py={4} bgColor="surface.subtle" borderRadius="4px">
      <HStack>
        <ShieldCheckIcon />
        <Text as="h3" textStyle="text/sm" fontWeight={500} color="text.primary">
          Advanced Feature
        </Text>
      </HStack>
      <Text textStyle="text/sm" color="text.secondary">
        This option is for advanced users who are confident in using their hardware wallet.
      </Text>
    </Stack>
  )
}
