import { Alert, Box, HStack, Icon, Text } from '@chakra-ui/react'
import { InfoIcon } from 'lucide-react'

export function HowDoesThisWork({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <Alert bgColor="neutral.50">
      <HStack>
        <Icon as={InfoIcon} color="neutral.900" boxSize="20px" />
        <Box color="neutral.800">
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
