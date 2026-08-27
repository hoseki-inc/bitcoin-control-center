import { Box } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { AnimatedPopInBoxes, AnimatedPopInSingleBox } from './animated-pop-in-boxes'

export default {
  title: 'Design system / Animated Pop In Boxes',
} satisfies StoryDefault

export const Multiple: Story = () => {
  return (
    <Box maxW="500px" p={2} border="1px solid" borderColor="red.500" borderRadius="md">
      <p>Above</p>
      <AnimatedPopInBoxes gap={4} maxW="640px">
        {[
          <Box key={1} w="100px" h="100px" bg="blue.200" borderRadius="md" />,
          <Box key={2} w="100px" h="100px" bg="green.200" borderRadius="md" />,
          <Box key={3} w="100px" h="100px" bg="red.200" borderRadius="md" />,
          <Box key={4} w="100px" h="100px" bg="yellow.200" borderRadius="md" />,
          <Box key={5} w="100px" h="100px" bg="pink.200" borderRadius="md" />,
          <Box key={6} w="100px" h="100px" bg="gray.200" borderRadius="md" />,
        ]}
      </AnimatedPopInBoxes>
      <p>Below</p>
    </Box>
  )
}

export const Single: Story = () => {
  return (
    <Box maxW="500px" p={2} border="1px solid" borderColor="red.500" borderRadius="md">
      <p>Above</p>
      <AnimatedPopInSingleBox display="flex" justifyContent="center" gap={4} maxW="640px">
        <Box key={1} w="100px" h="100px" bg="blue.200" borderRadius="md" />
      </AnimatedPopInSingleBox>
      <p>Below</p>
    </Box>
  )
}
