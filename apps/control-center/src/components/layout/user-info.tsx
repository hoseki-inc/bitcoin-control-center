import { HStack, IconButton, Tooltip } from '@chakra-ui/react'
import { Eye, EyeOff, SettingsIcon } from 'lucide-react'
import { Link } from 'react-router'
import { usePrivacy } from '../../hooks/use-privacy'
import { AppearanceToggle } from '../appearance-toggle'

export function UserInfo(): JSX.Element {
  const { hidden, toggle } = usePrivacy()
  const label = hidden ? 'Show sensitive values' : 'Hide sensitive values'
  return (
    <HStack spacing={1}>
      <Tooltip label={label}>
        <IconButton
          aria-label={label}
          aria-pressed={hidden}
          variant="ghost"
          icon={hidden ? <EyeOff size={20} /> : <Eye size={20} />}
          onClick={toggle}
        />
      </Tooltip>
      <AppearanceToggle />
      <IconButton as={Link} to="/settings" aria-label="Settings" variant="ghost" icon={<SettingsIcon size={20} />} />
    </HStack>
  )
}
