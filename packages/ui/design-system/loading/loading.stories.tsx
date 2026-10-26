import { Box, Button, Stack, Text } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { useState } from 'react'
import { SkeletonRegion, TextSkeleton, useRevealAfterLoading } from './loading'

export default {
  title: 'Design system / Loading',
} satisfies StoryDefault

export const Text_: Story = () => (
  <Stack gap={4}>
    <Text textStyle="text/7xl" fontWeight="semibold">
      <TextSkeleton width="6ch" />
    </Text>
    <Text textStyle="text/sm">
      Balance <TextSkeleton width="10ch" />
    </Text>
  </Stack>
)

export const Region: Story = () => (
  <SkeletonRegion label="Loading accounts" maxW="sm">
    <Stack gap={3} border="1px solid" borderColor="neutral.200" borderRadius="panel" p={5}>
      <Text textStyle="text/lg">
        <TextSkeleton width="12ch" />
      </Text>
      <Text textStyle="text/sm">
        <TextSkeleton width="8ch" />
      </Text>
    </Stack>
  </SkeletonRegion>
)

export const SlowAndFast: Story = () => {
  const [loading, setLoading] = useState(false)
  const reveal = useRevealAfterLoading(loading)
  const load = (ms: number): void => {
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
    }, ms)
  }
  return (
    <Stack gap={4} maxW="sm">
      <Text>A fast load (150 ms) never shows the skeleton; a slow one (2 s) fades the content in.</Text>
      <Stack direction="row">
        <Button
          onClick={() => {
            load(150)
          }}
        >
          Fast
        </Button>
        <Button
          onClick={() => {
            load(2_000)
          }}
        >
          Slow
        </Button>
      </Stack>
      <Box minH="72px">
        {loading ? (
          <SkeletonRegion label="Loading balance">
            <Text textStyle="text/3xl">
              <TextSkeleton width="9ch" />
            </Text>
          </SkeletonRegion>
        ) : (
          <Text textStyle="text/3xl" sx={reveal}>
            0.12345678 BTC
          </Text>
        )}
      </Box>
    </Stack>
  )
}
