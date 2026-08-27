import { HStack, Stack, Text } from '@chakra-ui/react'
import { ShieldCheckIcon } from 'lucide-react'

export function AdvancedFeatureAlert(): JSX.Element {
  return (
    <Stack px={6} py={4} bgColor="neutral.50" borderRadius="4px">
      <HStack>
        <ShieldCheckIcon />
        <Text as="h3" textStyle="text/sm" fontWeight={500} color="neutral.800">
          Advanced Feature
        </Text>
      </HStack>
      <Text textStyle="text/sm" color="neutral.700">
        This option is for advanced users who are confident in using their hardware wallet.
      </Text>
    </Stack>
  )
}
