import { Box, Button, HStack, SimpleGrid, Text } from '@chakra-ui/react'
import { Link as RouterLink, useNavigate } from 'react-router'
import type { StatementDto } from '../../trpc/server-types'
import { StatementCard } from './statement-card'

export function RecentStatements({
  statements,
  showGenerateButton = false,
}: {
  statements: StatementDto[]
  showGenerateButton?: boolean
}): JSX.Element | null {
  const navigate = useNavigate()

  if (statements.length === 0) {
    return null
  }

  const showViewAll = statements.length > 3
  const visibleStatements = statements.slice(0, 3)

  return (
    <Box>
      <Header showGenerateButton={showGenerateButton} />
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
        {visibleStatements.map((statement: StatementDto) => (
          <StatementCard
            key={statement.id}
            statement={statement}
            onView={() => {
              void navigate(`/statements/${statement.id}`)
            }}
          />
        ))}
      </SimpleGrid>
      {showViewAll && (
        <Box textAlign="center" p={4}>
          <Button as={RouterLink} to="/statements" variant="outline">
            View All
          </Button>
        </Box>
      )}
    </Box>
  )
}

function Header({ showGenerateButton }: { showGenerateButton: boolean }) {
  return (
    <HStack justifyContent="space-between" mb={8}>
      <Box flexGrow={1}>
        <Text as="h1" textStyle="text/md" color="neutral.900" fontWeight="medium">
          Recent Statements
        </Text>
        <Text textStyle="text/sm" color="neutral.600">
          Includes your statement activity plus partner-generated requests through secure API connections.
        </Text>
      </Box>
      {showGenerateButton && (
        <Button as={RouterLink} to="/statements/create" w="fit-content">
          Generate Statement
        </Button>
      )}
    </HStack>
  )
}
