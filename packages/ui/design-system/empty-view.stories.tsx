import type { Story, StoryDefault } from '@ladle/react'
import { EmptyView } from './empty-view'

export default {
  title: 'Design system / Empty View',
} satisfies StoryDefault

export const WithDescription: Story = () => (
  <EmptyView
    title="There is nothing to show"
    description="This is a longer description text with even more info than the title."
  />
)

export const WithoutDescription: Story = () => <EmptyView title="There is nothing to show" />
