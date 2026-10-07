import { Box, Button, HStack, Image, Stack, Text } from '@chakra-ui/react'
import { LinearGradient } from '@hoseki/packages/ui/design-system'
import { formatDateRange } from '@hoseki/packages/ui/utils'
import { format } from 'date-fns'
import type { StatementDto } from '../../trpc/server-types'

/** The View action's accessible name, shared by statement cards and the statements table. */
export function viewStatementLabel(statement: StatementDto): string {
  return `View statement created ${format(statement.createdAt, 'dd MMM yyyy h:mm a')}`
}

export function StatementCard({ statement, onView }: { statement: StatementDto; onView: () => void }): JSX.Element {
  return (
    <Box
      borderRadius="panel"
      borderWidth="1px"
      borderColor="neutral.200"
      bg="neutral.50"
      overflow="hidden"
      position="relative"
      minWidth={0}
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
      <Box
        position="relative"
        p={6}
        pb={0}
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
      >
        <Box
          maxH="150px"
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
      <HStack bg="white" borderTopWidth="1px" borderColor="neutral.200">
        <Stack py={2} px={4} spacing={0} flexGrow="1">
          <Text textStyle="text/sm" fontWeight="medium" color="neutral.900">
            Statement
          </Text>
          <Text textStyle="text/xs" color="neutral.600">
            Period: {formatDateRange(statement.openingDate, statement.closingDate)}
          </Text>
          <Text textStyle="text/xs" color="neutral.600">
            Created: {format(statement.createdAt, 'dd MMM yyyy h:mm a')}
          </Text>
        </Stack>
      </HStack>
    </Box>
  )
}
