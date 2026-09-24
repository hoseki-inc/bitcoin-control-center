import { Box, Button, Table, Tbody, Td, Text, Thead, Tr } from '@chakra-ui/react'
import { StatusBadge, Th, getBadgeConfigForStatement } from '@hoseki/packages/ui/prove-verify-ui'
import { format } from 'date-fns'
import { Link as RouterLink } from 'react-router'
import type { StatementDto } from '../../trpc/server-types'

export function StatementsTable({ statements }: { statements: StatementDto[] }): JSX.Element {
  return (
    <Box
      as="section"
      overflowX="auto"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Lets keyboard users scroll the table sideways.
      tabIndex={0}
      aria-label="Statements table"
      layerStyle="edge"
      borderRadius="panel"
    >
      <Table variant="data">
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
                <Text color="text.primary" fontWeight="medium">
                  {format(statement.createdAt, 'dd/MM/yyyy')}
                </Text>
                <Text color="text.secondary">{format(statement.createdAt, 'h:mm a')}</Text>
              </Td>
              <Td>
                <Text
                  textStyle="text/sm"
                  color="text.secondary"
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
              <Td textAlign="right">
                <Button
                  as={RouterLink}
                  variant="outline"
                  size="md"
                  aria-label={`View statement from ${format(statement.createdAt, 'MMMM d, yyyy h:mm a')}`}
                  to={`/statements/${statement.id}`}
                >
                  View
                </Button>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  )
}
