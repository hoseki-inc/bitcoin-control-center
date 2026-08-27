import type { Story } from '@ladle/react'
import { CheckCircleIcon, ClockIcon, InfoIcon, XCircleIcon } from 'lucide-react'
import { StatusBadge } from './status-badge'

export default {
  title: 'Prove and Verify / Status Badge',
}

export const WithIcons: Story = () => (
  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
    <StatusBadge status="info" label="Info" icon={InfoIcon} />
    <StatusBadge status="warning" label="Warning" icon={ClockIcon} />
    <StatusBadge status="success" label="Success" icon={CheckCircleIcon} />
    <StatusBadge status="error" label="Error" icon={XCircleIcon} />
    <StatusBadge status="neutral" label="Neutral" icon={InfoIcon} />
  </div>
)

export const Sizes: Story = () => (
  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
    <StatusBadge status="info" label="Small" size="sm" icon={InfoIcon} />
    <StatusBadge status="info" label="Medium" size="md" icon={InfoIcon} />
    <StatusBadge status="info" label="Medium is the default" icon={InfoIcon} />
  </div>
)

export const Statuses: Story = () => (
  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
    <StatusBadge status="info" label="Info" />
    <StatusBadge status="warning" label="Warning" />
    <StatusBadge status="success" label="Success" />
    <StatusBadge status="error" label="Error" />
    <StatusBadge status="neutral" label="Neutral" />
  </div>
)
