import { SimpleGrid } from '@chakra-ui/react'
import { useNavigate } from 'react-router'
import type { StatementDto } from '../../trpc/server-types'
import { StatementCard } from '../dashboard/statement-card'

export function StatementsGrid({ statements }: { statements: StatementDto[] }): JSX.Element {
  const navigate = useNavigate()

  return (
    <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
      {statements.map((statement: StatementDto) => (
        <StatementCard
          key={statement.id}
          statement={statement}
          onView={() => navigate(`/statements/${statement.id}`)}
        />
      ))}
    </SimpleGrid>
  )
}
