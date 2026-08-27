import { Flex, VStack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './button'

export default {
  title: 'Design system / Button',
} satisfies StoryDefault

const variants = ['primary', 'outline', 'tertiary', 'error']
const sizes = ['sm', 'md', 'lg']
const sizesNamings: Record<string, string> = {
  sm: 'Small',
  md: 'Medium',
  lg: 'Large',
}

export const Default: Story = () => {
  return (
    <VStack spacing={4}>
      {variants.map((variant) => (
        <Flex gap={4} alignItems="flex-end" key={variant}>
          {sizes.map((size) => (
            <Button key={`${variant}-${size}`} variant={variant} size={size} textTransform="capitalize">
              {`${variant} - ${sizesNamings[size]} `}
            </Button>
          ))}
        </Flex>
      ))}
    </VStack>
  )
}

export const Disabled: Story = () => {
  return (
    <VStack spacing={4}>
      {variants.map((variant) => (
        <Flex gap={4} alignItems="flex-end" key={variant}>
          {sizes.map((size) => (
            <Button key={`${variant}-${size}`} variant={variant} size={size} isDisabled textTransform="capitalize">
              {`${variant} - ${sizesNamings[size]} `}
            </Button>
          ))}
        </Flex>
      ))}
    </VStack>
  )
}

export const WithIcons: Story = () => {
  return (
    <VStack spacing={4}>
      {variants.map((variant) => (
        <Flex gap={4} alignItems="flex-end" key={variant}>
          {sizes.map((size) => (
            <Button
              key={`${variant}-${size}`}
              leftIcon={<ChevronLeft />}
              variant={variant}
              size={size}
              textTransform="capitalize"
            >
              {`${variant} - ${sizesNamings[size]} `}
            </Button>
          ))}
        </Flex>
      ))}

      {variants.map((variant) => (
        <Flex gap={4} alignItems="flex-end" key={variant}>
          {sizes.map((size) => (
            <Button
              key={`${variant}-${size}`}
              rightIcon={<ChevronRight />}
              variant={variant}
              size={size}
              textTransform="capitalize"
            >
              {`${variant} - ${sizesNamings[size]} `}
            </Button>
          ))}
        </Flex>
      ))}
    </VStack>
  )
}
