import { Box, Button, Text } from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router'
import type { StatementDto } from '../../trpc/server-types'
import { StatementsGrid } from '../statements/statements-grid'

export function RecentStatements({ statements }: { statements: StatementDto[] }): JSX.Element {
  const showViewAll = statements.length > 3

  return (
    <Box>
      <Header />
      <StatementsGrid statements={statements.slice(0, 3)} />
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
