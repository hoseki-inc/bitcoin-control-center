import { Box, Image, Text, VStack } from '@chakra-ui/react'
import { LinearGradient } from '@hoseki/packages/ui/design-system'

export function DesktopRequired(): JSX.Element {
  return (
    <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" bg="neutral.50" p={6}>
      <VStack spacing={8} maxW="400px" textAlign="center">
        <VStack spacing={4}>
          <Box position="relative" pb={4}>
            <Image src="/desktop-required.png" />
            <LinearGradient gradientDirection="from-bottom" baseColor="#F9F9F9" gradientSize={70} />
          </Box>

          <Text textStyle="text/xl" fontWeight="medium" color="neutral.900">
            Desktop Required
          </Text>

          <Text textStyle="text/sm" color="neutral.600">
            Bitcoin Control Center works best on desktop. To access all features, please switch to your desktop computer
            and visit this page again.
          </Text>
        </VStack>
      </VStack>
    </Box>
  )
}
