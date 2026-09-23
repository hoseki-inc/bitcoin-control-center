import { Box, Image, Text, VStack } from '@chakra-ui/react'
import { LinearGradient } from '@hoseki/packages/ui/design-system'

export function DesktopRequired(): JSX.Element {
  return (
    <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" bg="surface.subtle" p={6}>
      <VStack spacing={8} maxW="400px" textAlign="center">
        <VStack spacing={4}>
          <Box position="relative" pb={4}>
            <Image src="/desktop-required.png" />
            <LinearGradient
              gradientDirection="from-bottom"
              baseColor="var(--hoseki-colors-surface-subtle)"
              gradientSize={70}
            />
          </Box>

          <Text textStyle="text/xl" fontWeight="medium" color="text.primary">
            Desktop Required
          </Text>

          <Text textStyle="text/sm" color="text.secondary">
            Bitcoin Control Center works best on desktop. To access all features, please switch to your desktop computer
            and visit this page again.
          </Text>
        </VStack>
      </VStack>
    </Box>
  )
}
