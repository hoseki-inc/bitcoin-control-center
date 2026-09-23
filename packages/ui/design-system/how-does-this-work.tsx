import { Alert, Box, HStack, Icon, Text } from '@chakra-ui/react'
import { InfoIcon } from 'lucide-react'

export function HowDoesThisWork({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <Alert bgColor="surface.subtle">
      <HStack>
        <Icon as={InfoIcon} color="text.primary" boxSize="20px" />
        <Box color="text.primary">
          <Text textStyle="text/sm" fontWeight="medium">
            How does this work?
          </Text>
          <Text textStyle="text/sm" fontWeight="regular">
            {children}
          </Text>
        </Box>
      </HStack>
    </Alert>
  )
}
