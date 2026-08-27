import type { Story, StoryDefault } from '@ladle/react'
import { FileCheckIcon } from 'lucide-react'
import { EmptyView } from './empty-view'

export default {
  title: 'Design system / Empty View',
} satisfies StoryDefault

export const WithDescription: Story = () => (
  <EmptyView
    icon={<FileCheckIcon size={32} />}
    title="There is nothing to show"
    description="This is a longer description text with even more info than the title."
  />
)

export const WithoutDescription: Story = () => (
  <EmptyView icon={<FileCheckIcon size={32} />} title="There is nothing to show" />
)
