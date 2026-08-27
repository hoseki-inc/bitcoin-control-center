import { type BoxProps, Text, Tooltip } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'

export interface OverflownTextProps extends BoxProps {
  children: React.ReactNode
}

/**
 * A component that truncates text and shows the full text in a tooltip on hover when the text is overflown.
 */
export function OverflownText({ children, ...props }: OverflownTextProps): JSX.Element {
  const ref = useRef<HTMLParagraphElement>(null)
  const [isOverflown, setIsOverflown] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (element) {
      setIsOverflown(element.scrollWidth > element.clientWidth)
    }
  }, [])

  return (
    <Tooltip label={children} isDisabled={!isOverflown}>
      <Text position="relative" isTruncated ref={ref} {...props}>
        {children}
      </Text>
    </Tooltip>
  )
}
