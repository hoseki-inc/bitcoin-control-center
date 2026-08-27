import { Box } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { tokens } from './tokens'

export default {
  title: 'Design system / Tokens',
} satisfies StoryDefault

export const Colors: Story = () => (
  <Box>
    {Object.entries(tokens.colors).map(([baseColor, shades]) => (
      <Box key={baseColor}>
        {Object.entries(shades).map(([shade, hex]) => {
          const fullColor = `${baseColor}.${shade}`

          return (
            <Box key={fullColor} bgColor={fullColor} w="150px" h="50px" display="inline-block" m={2} p={1}>
              {fullColor}
              <br />
              {hex}
            </Box>
          )
        })}
      </Box>
    ))}
  </Box>
)
