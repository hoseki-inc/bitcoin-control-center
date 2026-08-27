import { FormControl, Input, Select, Stack, Textarea } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { LabelWithTooltip } from './label-with-tooltip'

export default {
  title: 'Design system / Forms / Label with Tooltip',
} satisfies StoryDefault

export const Default: Story = () => {
  return (
    <Stack spacing={6} maxW="500px">
      <FormControl>
        <LabelWithTooltip
          htmlFor="basic"
          labelText="Basic Input"
          tooltipText="This tooltip provides additional context about the input field"
        />
        <Input id="basic" placeholder="Enter text here" />
      </FormControl>

      <FormControl>
        <LabelWithTooltip
          htmlFor="textarea"
          labelText="Textarea Example"
          tooltipText="Use this area for longer text content"
        />
        <Textarea id="textarea" placeholder="Enter longer text here" />
      </FormControl>

      <FormControl>
        <LabelWithTooltip
          htmlFor="select"
          labelText="Select Option"
          tooltipText="Choose one of the available options from the dropdown"
        />
        <Select id="select" placeholder="Select an option">
          <option value="option1">Option 1</option>
          <option value="option2">Option 2</option>
          <option value="option3">Option 3</option>
        </Select>
      </FormControl>

      <FormControl>
        <LabelWithTooltip
          htmlFor="longTooltip"
          labelText="Long Tooltip Content"
          tooltipText="This tooltip has a longer explanation that spans multiple lines. It demonstrates how the tooltip handles more extensive content. Hover over the info icon to see the full text."
        />
        <Input id="longTooltip" placeholder="Enter text here" />
      </FormControl>
    </Stack>
  )
}
