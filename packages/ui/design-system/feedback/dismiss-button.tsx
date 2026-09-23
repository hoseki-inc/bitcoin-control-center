import { Button } from '@chakra-ui/react'

export function DismissButton({ onDismissClick }: { onDismissClick: () => void }): JSX.Element {
  return (
    <Button variant="link" color="text.tertiary" onClick={onDismissClick} w="fit-content" p={0} size="xs">
      Dismiss
    </Button>
  )
}
