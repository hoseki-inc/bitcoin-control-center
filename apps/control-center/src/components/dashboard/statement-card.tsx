import { Box, Button, HStack, Image, Skeleton, Stack, Text } from '@chakra-ui/react'
import { LinearGradient, TextSkeleton } from '@hoseki/packages/ui/design-system'
import { StatusBadge, getBadgeConfigForStatement } from '@hoseki/packages/ui/prove-verify-ui'
import { formatDateRange } from '@hoseki/packages/ui/utils'
import { format } from 'date-fns'
import type { ReactNode } from 'react'
import type { StatementDto } from '../../trpc/server-types'

const CREATED_FORMAT = 'MMM d, yyyy h:mm a'

/** The View action's accessible name, shared by statement cards and the statements table. */
export function viewStatementLabel(statement: StatementDto): string {
  return `View statement created ${format(statement.createdAt, CREATED_FORMAT)}`
}

/** The Delete action's accessible name. */
export function deleteStatementLabel(statement: StatementDto): string {
  return `Delete statement created ${format(statement.createdAt, CREATED_FORMAT)}`
}

export function StatementCard({
  statement,
  onView,
  footerAction,
}: {
  statement: StatementDto
  onView: () => void
  /** Shown at the right of the card's footer. */
  footerAction?: ReactNode
}): JSX.Element {
  return (
    <Box
      borderRadius="panel"
      borderWidth="1px"
      borderColor="neutral.200"
      bg="neutral.50"
      overflow="hidden"
      position="relative"
      minWidth={0}
      display="flex"
      flexDirection="column"
    >
      {/* Integrator Ribbon */}
      {statement.integrator && (
        <Box
          as="span"
          position="absolute"
          top={0}
          left={0}
          bg="secondary.400"
          color="black"
          height="40px"
          width="100%"
          display="flex"
          alignItems="center"
          justifyContent="center"
          textStyle="text/sm"
          textAlign="center"
          whiteSpace="nowrap"
          px={6}
          py={1.5}
          style={{ transform: 'translate(-80px, 25px) rotate(-35deg)' }}
          boxShadow="0px 0px 2px 0px #E9CA3A inset, 2px 2px 5px 0px #E9CA3A inset"
          zIndex={1}
        >
          {statement.integrator.name}
        </Box>
      )}
      {/* Only statements that need attention get a status. */}
      {statement.status !== 'completed' && (
        <Box position="absolute" top={3} right={3} zIndex={1}>
          <StatusBadge {...getBadgeConfigForStatement(statement.status)} />
        </Box>
      )}
      <Box
        position="relative"
        p={6}
        pb={0}
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
      >
        {/* A fixed height, so the card doesn't grow when the image arrives. */}
        <Box
          h="150px"
          w="150px"
          overflow="hidden"
          boxShadow="6px 0 12px 0 rgba(0, 0, 0, 0.07), -6px 0 12px 0 rgba(0, 0, 0, 0.07), 0 -6px 12px 0 rgba(0, 0, 0, 0.07)"
        >
          <Image src="/statements/satoshi-statement.jpg" alt="" w="150px" />
        </Box>
        <LinearGradient
          gradientDirection="from-bottom"
          baseColor="rgba(0, 0, 0, 0.20)"
          gradientSize={60}
          justify="center"
          alignItems="flex-end"
          pointerEvents="auto"
          pb={4}
        >
          <Button onClick={onView} size="sm" variant="outline" aria-label={viewStatementLabel(statement)}>
            View
          </Button>
        </LinearGradient>
      </Box>
      {/* Fills the card so cards stretched to a taller neighbour stay white to the bottom. */}
      <HStack bg="white" borderTopWidth="1px" borderColor="neutral.200" flexGrow={1} alignItems="center" pr={2}>
        <Stack py={2} px={4} spacing={0} flexGrow="1" minW={0}>
          <Text textStyle="text/sm" fontWeight="medium" color="neutral.900">
            Statement
          </Text>
          <Text textStyle="text/xs" color="neutral.600">
            Period: {formatDateRange(statement.openingDate, statement.closingDate, undefined, { shortMonths: true })}
          </Text>
          <Text textStyle="text/xs" color="neutral.600">
            Created: {format(statement.createdAt, CREATED_FORMAT)}
          </Text>
        </Stack>
        {footerAction}
      </HStack>
    </Box>
  )
}

/** A statement card's outline while statements load: the page preview and the footer's three lines. */
export function StatementCardSkeleton(): JSX.Element {
  return (
    <Box
      borderRadius="panel"
      borderWidth="1px"
      borderColor="neutral.200"
      bg="neutral.50"
      overflow="hidden"
      minWidth={0}
      display="flex"
      flexDirection="column"
    >
      <Box p={6} pb={0} display="flex" justifyContent="center">
        <Skeleton h="150px" w="150px" borderRadius="none" />
      </Box>
      <HStack bg="white" borderTopWidth="1px" borderColor="neutral.200" flexGrow={1} pr={2}>
        <Stack py={2} px={4} spacing={0} flexGrow="1" minW={0}>
          <Text textStyle="text/sm" fontWeight="medium">
            <TextSkeleton width="9ch" />
          </Text>
          <Text textStyle="text/xs">
            <TextSkeleton width="22ch" />
          </Text>
          <Text textStyle="text/xs">
            <TextSkeleton width="26ch" />
          </Text>
        </Stack>
      </HStack>
    </Box>
  )
}
