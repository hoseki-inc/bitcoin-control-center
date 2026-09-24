import { IconButton, type IconButtonProps, Tooltip } from '@chakra-ui/react'
import { Eye, EyeOff } from 'lucide-react'
import { usePrivacy } from '../hooks/use-privacy'
import { IconSwap } from './reveal'

/** Hide or show balances everywhere. Sits beside the appearance toggle and matches it. */
export function PrivacyToggle(props: Omit<IconButtonProps, 'aria-label'>): JSX.Element {
  const { hidden, toggle } = usePrivacy()
  const label = hidden ? 'Show balances' : 'Hide balances'
  return (
    <Tooltip label={label}>
      <IconButton
        aria-label={label}
        aria-pressed={hidden}
        variant="ghost"
        overflow="hidden"
        icon={
          <IconSwap swapKey={hidden ? 'hidden' : 'shown'}>{hidden ? <EyeOff size={20} /> : <Eye size={20} />}</IconSwap>
        }
        onClick={toggle}
        {...props}
      />
    </Tooltip>
  )
}
