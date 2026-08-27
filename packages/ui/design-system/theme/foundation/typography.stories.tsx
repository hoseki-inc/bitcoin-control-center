import { Box, HStack, Stack, Text } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { newTextStyles, oldTextStyles } from './typography'

export default {
  title: 'Design system / Typography / Foundation',
} satisfies StoryDefault

export const Typography: Story = () => {
  // Group styles by prefix
  const textStyles = Object.fromEntries(Object.entries(newTextStyles).filter(([key]) => key.startsWith('text/')))
  const overlineStyles = Object.fromEntries(
    Object.entries(newTextStyles).filter(([key]) => key.startsWith('overline/')),
  )
  const labelStyles = Object.fromEntries(Object.entries(newTextStyles).filter(([key]) => key.startsWith('label/')))

  return (
    <Stack direction="column" spacing={10}>
      <Text textStyle="text/8xl" fontWeight="bold">
        Typography — Text Styles 📝 ✨
      </Text>

      <TypographyStyleSection title='"text/" prefix' styles={textStyles} />
      <TypographyStyleSection title='"overline/" prefix' styles={overlineStyles} />
      <TypographyStyleSection title='"label/" prefix' styles={labelStyles} />

      <TypographyStyleSection title="Old Text Styles 📜 👴" styles={oldTextStyles} />
    </Stack>
  )
}

function displayPxIfRem(value: string | number) {
  if (typeof value === 'string' && value.includes('rem')) {
    return `${Number(value.replace('rem', '')) * 16}px`
  }
  return value
}

type TypographyStyleSectionProps = {
  title: string
  styles: Record<string, Record<string, string | number>>
}
const TypographyStyleSection = ({ title, styles }: TypographyStyleSectionProps) => (
  <>
    <Text textStyle="text/7xl" fontWeight="semibold">
      {title}
    </Text>
    {Object.entries(styles).map(([variant, style]) => {
      return (
        <Box key={variant}>
          <Text textStyle="text/xl">{variant}</Text>
          <Text textStyle={variant}>The Quick Brown Fox Jumps Over The Lazy Dog</Text>
          <HStack spacing={4} color="neutral.500">
            {Object.entries(style).map(([key, value]) => (
              <Text key={key}>
                {key}: {value} or {displayPxIfRem(value)}
              </Text>
            ))}
          </HStack>
        </Box>
      )
    })}
  </>
)
