import { HStack, Icon } from '@chakra-ui/react'
import { SettingsIcon } from 'lucide-react'
import { Link } from 'react-router'

export function UserInfo(): JSX.Element {
  return (
    <HStack gap={4}>
      <Link to="/settings" aria-label="Settings">
        <Icon as={SettingsIcon} boxSize={5} mt={1.5} />
      </Link>
    </HStack>
  )
}
