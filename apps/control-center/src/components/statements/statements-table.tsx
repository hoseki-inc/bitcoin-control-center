import { Box, Button, HStack, Table, Tbody, Td, Text, Thead, Tr } from '@chakra-ui/react'
import { StatusBadge, Th, getBadgeConfigForStatement } from '@hoseki/packages/ui/prove-verify-ui'
import { format } from 'date-fns'
import { Link as RouterLink } from 'react-router'
import type { StatementDto } from '../../trpc/server-types'
import { deleteStatementLabel, viewStatementLabel } from '../dashboard/statement-card'
import { DeleteStatementButton } from './delete-statement-button'

export function StatementsTable({ statements }: { statements: StatementDto[] }): JSX.Element {
  return (
    <Box overflowX="auto" border="1px solid" borderColor="neutral.200" borderRadius="panel">
      <Table variant="data" aria-label="Statements">
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
                  {format(statement.createdAt, 'MMM d, yyyy')}
                </Text>
                <Text color="neutral.600">{format(statement.createdAt, 'h:mm a')}</Text>
              </Td>
              <Td>
                <Text
                  textStyle="text/sm"
                  color="neutral.700"
                  fontWeight="medium"
                  whiteSpace="normal"
                  minW="120px"
                  maxW="32ch"
                  overflowWrap="anywhere"
                >
                  {statement.integrator ? statement.integrator.name : 'Self-initiated'}
                </Text>
              </Td>
              <Td>
                <Box display="inline-block">
                  <StatusBadge {...getBadgeConfigForStatement(statement.status)} />
                </Box>
              </Td>
              <Td>
                <HStack justifyContent="flex-end">
                  <Button
                    as={RouterLink}
                    variant="outline"
                    size="md"
                    aria-label={viewStatementLabel(statement)}
                    to={`/statements/${statement.id}`}
                  >
                    View
                  </Button>
                  {statement.status !== 'pending' && (
                    <DeleteStatementButton statementId={statement.id} iconLabel={deleteStatementLabel(statement)} />
                  )}
                </HStack>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  )
}
