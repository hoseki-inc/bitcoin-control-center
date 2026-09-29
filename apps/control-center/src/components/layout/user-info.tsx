import { IconButton } from '@chakra-ui/react'
import { SettingsIcon } from 'lucide-react'
import { Link } from 'react-router'

export function UserInfo(): JSX.Element {
  return <IconButton as={Link} to="/settings" aria-label="Settings" variant="ghost" icon={<SettingsIcon size={20} />} />
}
