import { Button, HStack, Icon, Text } from '@chakra-ui/react'
import { XIcon } from 'lucide-react'

export function DismissButton({ onDismissClick }: { onDismissClick: () => void }): JSX.Element {
  return (
    <Button variant="link" color="neutral.400" onClick={onDismissClick} w="fit-content" p={0} size="xs">
      <HStack>
        <Icon as={XIcon} height={4} width={4} />
        <Text as="span">Dismiss</Text>
      </HStack>
    </Button>
  )
}
