import type { Story, StoryDefault } from '@ladle/react'
import { DateInput } from './date-input'

export default {
  title: 'Design system / Forms / Date Input',
} satisfies StoryDefault

export const JustDate: Story = () => (
  <DateInput value={new Date()} onChange={(date) => console.log(date)} max={new Date()} min={new Date('2009-01-03')} />
)

export const DateWithTime: Story = () => (
  <DateInput
    type="datetime-local"
    value={new Date()}
    onChange={(date) => console.log(date)}
    max={new Date()}
    min={new Date('2009-01-03')}
  />
)
