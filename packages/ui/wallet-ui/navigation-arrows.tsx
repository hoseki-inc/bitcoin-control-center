import { Button, HStack, Spacer } from '@chakra-ui/react'
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import type { MouseEventHandler } from 'react'

export function NavigationArrows({
  onBack,
  onForward,
}: {
  onBack?: MouseEventHandler<HTMLButtonElement>
  onForward?: MouseEventHandler<HTMLButtonElement>
}): JSX.Element {
  return (
    <HStack justifyContent="space-between" width="full" mt={4}>
      {onBack ? <NavigationArrow onClick={onBack} direction="left" /> : <Spacer />}
      {onForward ? <NavigationArrow onClick={onForward} direction="right" /> : <Spacer />}
    </HStack>
  )
}

function NavigationArrow({
  onClick,
  direction,
}: {
  onClick: MouseEventHandler<HTMLButtonElement>
  direction: 'left' | 'right'
}) {
  const Icon = direction === 'left' ? ArrowLeftIcon : ArrowRightIcon

  return (
    <Button
      onClick={onClick}
      bgColor="neutral.50"
      borderRadius="50%"
      width="40px"
      height="40px"
      minWidth="40px"
      p={0}
      _hover={{ bgColor: 'neutral.100' }}
      _active={{ bgColor: 'neutral.200' }}
      _focus={{ bgColor: 'neutral.200' }}
    >
      <Icon color="black" />
    </Button>
  )
}
