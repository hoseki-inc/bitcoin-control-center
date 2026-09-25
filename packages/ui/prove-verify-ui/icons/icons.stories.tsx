import { Flex, Stack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { type FC, Fragment } from 'react'
import * as All from './all-icons'
import type { ComponentProps as IconComponentProps } from './create-icon'

export default {
  title: 'Design system / Icons / Local',
} satisfies StoryDefault

const commonProps = {
  boxSize: '24px',
}

export const AllIcons: Story = () => {
  const props = {
    boxSize: '24px',
    color: 'neutral.500',
    fill: 'none',
    stroke: 'currentColor',
  }

  return (
    <Flex gap={4} wrap="wrap">
      {Object.entries(All).map(([key, Icon]) => {
        // SAFETY: Every export in All is a generated icon component with the shared icon props contract.
        const IconComponent = Icon as FC<IconComponentProps>
        return (
          <Fragment key={key}>
            <IconComponent {...props} />
          </Fragment>
        )
      })}
    </Flex>
  )
}

export const SameIconDifferentColorCombinations: Story = () => {
  return (
    <Flex>
      <All.CheckCircleFilledIcon color="success.600" {...commonProps} />
      <All.CheckCircleFilledIcon color3="warning.600" stroke="neutral.900" color2="neutral.900" {...commonProps} />
      <All.CheckCircleFilledIcon color="error.600" stroke="neutral.900" color2="white" {...commonProps} />
    </Flex>
  )
}

export const WithStroke: Story = () => {
  const strokeColors = ['shades.0', 'shades.100', 'transparent', 'success.600', 'warning.600', 'error.600']
  return (
    <Stack>
      {strokeColors.map((strokeColor) => (
        <Flex gap={4} wrap="wrap" key={strokeColor}>
          <All.CheckCircleFilledIcon stroke={strokeColor} {...commonProps} fill="success.600" />
          <All.AlertTriangleFilledIcon stroke={strokeColor} {...commonProps} fill="warning.600" />
        </Flex>
      ))}
    </Stack>
  )
}
