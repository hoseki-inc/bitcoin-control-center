import { Box, forwardRef } from '@chakra-ui/react'
import { Link, useLocation } from 'react-router'

export const LinkIfNotCurrent = forwardRef<{ to: string; children: React.ReactNode }, 'a'>(
  ({ to, children, ...props }, ref) => {
    const location = useLocation()
    return location.pathname + location.search === to ? (
      <Box ref={ref} {...props}>
        {children}
      </Box>
    ) : (
      <Link ref={ref} to={to} {...props}>
        {children}
      </Link>
    )
  },
)

LinkIfNotCurrent.displayName = 'LinkIfNotCurrent'
