import { Box, Button, SimpleGrid, Text } from '@chakra-ui/react'
import { Link as RouterLink, useNavigate } from 'react-router'
import type { StatementDto } from '../../trpc/server-types'
import { StatementCard } from './statement-card'

export function RecentStatements({ statements }: { statements: StatementDto[] }): JSX.Element | null {
  const navigate = useNavigate()

  if (statements.length === 0) {
    return null
  }

  const showViewAll = statements.length > 3
  const visibleStatements = statements.slice(0, 3)

  return (
    <Box>
      <Header />
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

function Header(): JSX.Element {
  return (
    <Box mb={6}>
      <Text as="h2" textStyle="text/xl" color="neutral.900" fontWeight="medium">
        Recent Statements
      </Text>
      <Text textStyle="text/sm" color="neutral.600" mt={2}>
        Your latest self-custody statements, ready to view or download.
      </Text>
    </Box>
  )
}
