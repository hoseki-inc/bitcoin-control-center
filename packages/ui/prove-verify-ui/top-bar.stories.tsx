import { Box, Stack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { TopBar } from './top-bar'

export default {
  title: 'Prove and Verify / Top Bar',
} satisfies StoryDefault

export const Default: Story = () => (
  <Stack gap={8}>
    <Wrapper title="Basic TopBar with Items">
      <TopBar>
        <TopBar.Item href="/dashboard">Dashboard</TopBar.Item>
        <TopBar.Item href="/settings">Settings</TopBar.Item>
      </TopBar>
    </Wrapper>

    <Wrapper title="TopBar with Mixed Content">
      <TopBar>
        <Box>
          <TopBar.Item href="/home">Home</TopBar.Item>
          <TopBar.Item href="/claims" ml={4}>
            Claims
          </TopBar.Item>
        </Box>
        <TopBar.Item href="/profile">Profile</TopBar.Item>
      </TopBar>
    </Wrapper>

    <Wrapper title="TopBar with Single Item">
      <TopBar>
        <TopBar.Item href="/back">← Back to Dashboard</TopBar.Item>
      </TopBar>
    </Wrapper>
  </Stack>
)

export const WithCustomStyling: Story = () => (
  <Stack gap={8}>
    <Wrapper title="TopBar with Background">
      <TopBar bg="gray.50" p={4} borderRadius="md">
        <TopBar.Item href="/dashboard" color="blue.500">
          Dashboard
        </TopBar.Item>
        <TopBar.Item href="/settings" color="gray.600">
          Settings
        </TopBar.Item>
      </TopBar>
    </Wrapper>

    <Wrapper title="TopBar with Border">
      <TopBar borderBottom="1px solid" borderColor="gray.200" pb={2}>
        <TopBar.Item href="/home">Home</TopBar.Item>
        <TopBar.Item href="/logout" color="red.500">
          Logout
        </TopBar.Item>
      </TopBar>
    </Wrapper>
  </Stack>
)

export const WithMultipleItems: Story = () => (
  <Wrapper title="TopBar with Multiple Navigation Items">
    <TopBar>
      <Box>
        <TopBar.Item href="/dashboard" mr={6}>
          Dashboard
        </TopBar.Item>
        <TopBar.Item href="/claims" mr={6}>
          Claims
        </TopBar.Item>
        <TopBar.Item href="/requests">Access Requests</TopBar.Item>
      </Box>
      <Box>
        <TopBar.Item href="/help" mr={6}>
          Help
        </TopBar.Item>
        <TopBar.Item href="/profile">Profile</TopBar.Item>
      </Box>
    </TopBar>
  </Wrapper>
)

function Wrapper({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Box mb={2} fontSize="sm" fontWeight="medium" color="gray.600">
        {title}
      </Box>
      <Box border="2px dashed" borderColor="blue.200" borderRadius="md" p={4}>
        {children}
      </Box>
    </Box>
  )
}
