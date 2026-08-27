import { Box, Button, Table, Tbody, Td, Text, Thead, Tr } from '@chakra-ui/react'
import { StatusBadge, Th, getBadgeConfigForStatement } from '@hoseki/packages/ui/prove-verify-ui'
import { format } from 'date-fns'
import { Link as RouterLink } from 'react-router'
import type { StatementDto } from '../../trpc/server-types'

export function StatementsTable({ statements }: { statements: StatementDto[] }): JSX.Element {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Generation Date</Th>
          <Th>Requester</Th>
          <Th>Status</Th>
          <Th textAlign="right">Action</Th>
        </Tr>
      </Thead>
      <Tbody>
        {statements.map((statement) => (
          <Tr key={statement.id}>
            <Td>
              <Text color="neutral.900" fontWeight="medium">
                {format(statement.createdAt, 'dd/MM/yyyy')}
              </Text>
              <Text color="neutral.600">{format(statement.createdAt, 'h:mm a')}</Text>
            </Td>
            <Td>
              <Text textStyle="text/sm" color="neutral.700" fontWeight="medium">
                {statement.integrator ? statement.integrator.name : 'Self-initiated'}
              </Text>
            </Td>
            <Td>
              <Box display="inline-block">
                <StatusBadge {...getBadgeConfigForStatement(statement.status)} />
              </Box>
            </Td>
            <Td textAlign="right">
              <Button as={RouterLink} variant="outline" size="md" to={`/statements/${statement.id}`}>
                View
              </Button>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  )
}
