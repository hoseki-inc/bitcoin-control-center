import { Box, Button, HStack, SimpleGrid, Text, VStack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { AlertCircle, Info, Settings } from 'lucide-react'
import { Panel } from './panel'

export default {
  title: 'Design system / Panel',
} satisfies StoryDefault

export const Standard: Story = () => {
  return (
    <Panel title="Information Panel">
      <Box p={4}>
        <Text>This is a standard panel with just a title.</Text>
      </Box>
    </Panel>
  )
}

export const WithIcon: Story = () => {
  return (
    <Panel icon={<Info />} title="Information Panel">
      <Box p={4}>
        <Text>This is a panel with an information icon.</Text>
      </Box>
    </Panel>
  )
}

export const Warning: Story = () => {
  return (
    <Panel icon={<AlertCircle />} title="Warning Panel" colorMode="warning">
      <Box p={4}>
        <Text>This is a warning panel with an alert icon.</Text>
      </Box>
    </Panel>
  )
}

export const WithRightContent: Story = () => {
  const customHeader = (
    <HStack p={4} bgColor="neutral.50" color="neutral.600" borderBottom="solid 1px" borderColor="neutral.200">
      <Info />
      <Text as="h1" textStyle="text/md" fontWeight="medium">
        Panel with Actions
      </Text>
      <Button size="sm" variant="ghost" leftIcon={<Settings />} ml="auto">
        Settings
      </Button>
    </HStack>
  )

  return (
    <Panel customHeader={customHeader}>
      <Box p={4}>
        <Text>This panel has an action button in the header.</Text>
      </Box>
    </Panel>
  )
}

export const CustomHeader: Story = () => {
  const customHeader = (
    <HStack p={4} bgColor="primary.50" color="primary.600" borderBottom="solid 1px" borderColor="primary.200">
      <Info />
      <Text as="h1" textStyle="text/md" fontWeight="medium">
        Custom Header Panel
      </Text>
      <Button size="sm" variant="ghost" ml="auto">
        Action
      </Button>
    </HStack>
  )

  return (
    <Panel customHeader={customHeader}>
      <Box p={4}>
        <Text>This panel has a completely custom header.</Text>
      </Box>
    </Panel>
  )
}

export const CustomHeaderWithPanelHeader: Story = () => {
  const customHeader = (
    <Panel.Header
      icon={<Info />}
      title="Custom Panel Header"
      colorMode="neutral"
      rightContent={
        <HStack spacing={2}>
          <Button size="sm" variant="ghost" leftIcon={<Settings />}>
            Settings
          </Button>
          <Button size="sm" variant="ghost">
            Action
          </Button>
        </HStack>
      }
    />
  )

  return (
    <Panel customHeader={customHeader}>
      <Box p={4}>
        <Text>
          This panel uses Panel.Header as a custom header, allowing us to use the built-in header component while
          maintaining full control over its content.
        </Text>
      </Box>
    </Panel>
  )
}

export const WithContent: Story = () => {
  return (
    <Panel icon={<Info />} title="Panel with Content">
      <VStack p={4} spacing={4} align="stretch">
        <Text>This panel contains multiple content sections.</Text>
        <Box p={3} bgColor="neutral.50" borderRadius="md">
          <Text textStyle="text/sm">A content box with different styling</Text>
        </Box>
        <Text>You can add any content inside the panel.</Text>
      </VStack>
    </Panel>
  )
}

export const MultiplePanels: Story = () => {
  return (
    <SimpleGrid columns={3} spacing={4} maxW="1200px">
      <Panel icon={<Info />} title="First Panel">
        <Box p={4}>
          <Text>This is the first panel in a grid.</Text>
        </Box>
      </Panel>
      <Panel icon={<AlertCircle />} title="Second Panel" colorMode="warning">
        <Box p={4}>
          <Text>This is the second panel with a warning style.</Text>
        </Box>
      </Panel>
      <Panel icon={<Info />} title="Third Panel">
        <Box p={4}>
          <Text>This is the third panel in the grid.</Text>
        </Box>
      </Panel>
    </SimpleGrid>
  )
}
