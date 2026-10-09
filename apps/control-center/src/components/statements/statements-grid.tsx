import { SimpleGrid } from '@chakra-ui/react'
import { useNavigate } from 'react-router'
import type { StatementDto } from '../../trpc/server-types'
import { StatementCard, deleteStatementLabel } from '../dashboard/statement-card'
import { DeleteStatementButton } from './delete-statement-button'

/** With `canDelete`, finished statements get a trash button; Home's recent statements leave it off. */
export function StatementsGrid({
  statements,
  canDelete = false,
}: {
  statements: StatementDto[]
  canDelete?: boolean
}): JSX.Element {
  const navigate = useNavigate()

  return (
    <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
      {statements.map((statement: StatementDto) => (
        <StatementCard
          key={statement.id}
          statement={statement}
          onView={() => {
            void navigate(`/statements/${statement.id}`)
          }}
          footerAction={
            !canDelete || statement.status === 'pending' ? undefined : (
              <DeleteStatementButton
                statementId={statement.id}
                iconLabel={deleteStatementLabel(statement)}
                iconSize="sm"
              />
            )
          }
        />
      ))}
    </SimpleGrid>
  )
}
