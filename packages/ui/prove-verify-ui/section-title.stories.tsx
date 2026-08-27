import { Box, Button, Stack } from '@chakra-ui/react'
import type { Story } from '@ladle/react'
import { SectionTitle } from './section-title'

export default {
  title: 'Prove and Verify / Section Title',
}

export const SectionTitles: Story = () => (
  <Stack gap={8}>
    <Wrapper>
      <SectionTitle title="Section Title" />
    </Wrapper>
    <Wrapper>
      <SectionTitle
        title="Section Title"
        description="Section description lorem ipsum dolor sit amet, consectetur adipiscing elit."
      />
    </Wrapper>
    <Wrapper>
      <SectionTitle
        title="Section Title"
        description="Section description lorem ipsum dolor sit amet, consectetur adipiscing elit."
        rightContent={<Button>Button</Button>}
      />
    </Wrapper>
  </Stack>
)

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <Box border="2px dashed" borderColor="blue" borderRadius="md" p={8}>
      {children}
      <p>
        Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore
        magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo
        consequat.
      </p>
    </Box>
  )
}
