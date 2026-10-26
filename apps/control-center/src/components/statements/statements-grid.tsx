import { SimpleGrid } from '@chakra-ui/react'
import { useNavigate } from 'react-router'
import type { StatementDto } from '../../trpc/server-types'
import { StatementCard, StatementCardSkeleton } from '../dashboard/statement-card'
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
            canDelete ? <DeleteStatementButton statement={statement} variant="icon" iconSize="sm" /> : undefined
          }
        />
      ))}
    </SimpleGrid>
  )
}

/** The grid's outline while statements load. */
export function StatementsGridSkeleton({ count = 3 }: { count?: number }): JSX.Element {
  return (
    <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
      {Array.from({ length: count }, (_, index) => (
        <StatementCardSkeleton key={index} />
      ))}
    </SimpleGrid>
  )
}
