import { Box, Button, Stack } from '@chakra-ui/react'
import { ErrorBanner, Spinner } from '@hoseki/packages/ui/design-system'
import { SectionTitle } from '@hoseki/packages/ui/prove-verify-ui'
import { Grid2X2Icon, ListIcon } from 'lucide-react'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { StatementsEmptyState } from '../../components/statements/statements-empty-state'
import { StatementsGrid } from '../../components/statements/statements-grid'
import { StatementsTable } from '../../components/statements/statements-table'
import { trpc } from '../../trpc'

export function StatementListPage(): JSX.Element {
  const [viewType, setViewType] = useState<'grid' | 'table'>('grid')
  const { data: statements, isLoading, error } = trpc.portalProve.statement.list.useQuery()

  if (isLoading) {
    return (
      <Box mt={8}>
        <Header showGenerateButton={false} />
        <Spinner fullPage size="xl" />
      </Box>
    )
  }

  if (error) {
    return (
      <Box mt={8}>
        <Header showGenerateButton={true} />
        <ErrorBanner mt={8} mb={4} message={`Error fetching your statements: ${error?.message}`} />
      </Box>
    )
  }

  if (!statements || statements.length === 0) {
    return (
      <Box mt={8}>
        <Header showGenerateButton={false} hideDivider descriptionVersion="empty-state" />
        <StatementsEmptyState />
      </Box>
    )
  }

  return (
    <Box mt={8}>
      <Header showGenerateButton={true} />
      <Stack gap={2}>
        <Box textAlign="right">
          <Button
            variant="ghost"
            size="xs"
            px={2}
            py={2}
            fontSize="xs"
            onClick={() => {
              setViewType(viewType === 'grid' ? 'table' : 'grid')
            }}
            _focus={{ boxShadow: 'none' }}
          >
            {viewType === 'grid' ? <ListIcon size={16} /> : <Grid2X2Icon size={16} />}
          </Button>
        </Box>
        {viewType === 'grid' ? <StatementsGrid statements={statements} /> : <StatementsTable statements={statements} />}
      </Stack>
    </Box>
  )
}

function Header({
  showGenerateButton,
  hideDivider = false,
  descriptionVersion = 'default',
}: {
  showGenerateButton: boolean
  hideDivider?: boolean
  descriptionVersion?: 'default' | 'empty-state'
}) {
  const description =
    descriptionVersion === 'empty-state'
      ? 'Once you generate a statement, your statement will appear here. Generate your first statement below to get started.'
      : 'Includes your statement activity plus partner-generated requests through secure API connections.'

  return (
    <SectionTitle
      title="Statements"
      description={description}
      rightContent={
        showGenerateButton ? (
          <Button as={RouterLink} to="/statements/create" w="fit-content">
            Generate Statement
          </Button>
        ) : undefined
      }
      hideDivider={hideDivider}
    />
  )
}
