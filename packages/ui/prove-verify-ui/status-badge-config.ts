import type { AccessRequestStatus, StatementStatus } from '@hoseki/packages/schemas'
import type { ClaimAccessStatus, ClaimStatus } from '@hoseki/packages/schemas/prove'
import { InfoIcon } from 'lucide-react'
import { CheckCircleFilledIcon, TimerCircleFilledIcon, XCircleFilledIcon } from './icons'
import type { StatusBadgeProps } from './status-badge'

export function getBadgeConfigForClaim(status: ClaimStatus /* , expiresAt: Date | null */): StatusBadgeProps {
  switch (status) {
    case 'verified':
      return { status: 'success', label: status, icon: CheckCircleFilledIcon }
    case 'pending':
      return { status: 'warning', label: status, icon: TimerCircleFilledIcon }
    case 'expired':
      return { status: 'neutral', label: status, icon: XCircleFilledIcon }
    case 'unverified':
      return { status: 'neutral', label: status, icon: InfoIcon }
  }
}

export function getBadgeConfigForClaimAccess(status: ClaimAccessStatus): StatusBadgeProps {
  switch (status) {
    case 'active':
      return { status: 'success', label: status, icon: CheckCircleFilledIcon }
    case 'inactive':
      return { status: 'warning', label: status, icon: TimerCircleFilledIcon }
    case 'disconnected':
      return { status: 'neutral', label: status, icon: XCircleFilledIcon }
  }

  // Uncomment when reverification is enabled
  //
  // const daysUntilExpiration = differenceInDays(expiresAt, new Date())
  // if (daysUntilExpiration > 10) {
  //   return { status: 'success', label: 'Verified' }
  // }
  // return { status: 'warning', label: `Expires ${getRelativeTimeFromNow(expiresAt)}` }
}

export function getBadgeConfigForAccessRequest(status: AccessRequestStatus): StatusBadgeProps {
  switch (status) {
    case 'accepted':
      return { status: 'success', label: 'Completed', icon: CheckCircleFilledIcon }
    case 'pending':
      return { status: 'warning', label: status, icon: TimerCircleFilledIcon }
    case 'expired':
      return { status: 'neutral', label: status, icon: XCircleFilledIcon }
    case 'rejected':
      return { status: 'error', label: status, icon: XCircleFilledIcon }
  }
}

export function getBadgeConfigForStatement(status: StatementStatus): StatusBadgeProps {
  switch (status) {
    case 'completed':
      return { status: 'success', label: status, icon: CheckCircleFilledIcon }
    case 'pending':
      return { status: 'warning', label: status, icon: TimerCircleFilledIcon }
    case 'failed':
      return { status: 'error', label: status, icon: XCircleFilledIcon }
  }
}

export function getBadgeConfigForKeystore(status: 'verified' | 'identified' | 'pending'): StatusBadgeProps {
  switch (status) {
    case 'verified':
      return { status: 'success', label: status, icon: CheckCircleFilledIcon }
    case 'identified':
      return { status: 'neutral', label: status, icon: InfoIcon }
    case 'pending':
      return { status: 'warning', label: status, icon: TimerCircleFilledIcon }
  }
}
