import { Box, Button, Flex, IconButton, Stack, chakra } from '@chakra-ui/react'
import { ErrorBanner, Spinner } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { Grid2X2Icon, ListIcon } from 'lucide-react'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { StatementsEmptyState } from '../../components/statements/statements-empty-state'
import { StatementsGrid } from '../../components/statements/statements-grid'
import { StatementsTable } from '../../components/statements/statements-table'
import { trpc } from '../../trpc'

export function StatementListPage(): JSX.Element {
  const [viewType, setViewType] = useState<'grid' | 'table'>('grid')
  const { data: statements, isLoading, error, refetch } = trpc.portalProve.statement.list.useQuery()

  if (isLoading) {
    return (
      <Box mt={8}>
        <Header showGenerateButton={false} />
        <Spinner fullPage size="xl" />
      </Box>
    )
  }

  // A failed refresh keeps the statements already shown; the error is only for having none.
  if (error && statements === undefined) {
    return (
      <Box mt={8}>
        <Header showGenerateButton={true} />
        <ErrorBanner
          mt={8}
          mb={4}
          message={`Error fetching your statements: ${error.message}`}
          rightContent={
            <Button variant="outline" flexShrink={0} onClick={() => void refetch()}>
              Try Again
            </Button>
          }
        />
      </Box>
    )
  }

  if (statements.length === 0) {
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
        <Flex as="fieldset" justify="flex-end" gap={1} aria-label="Statement view">
          <IconButton
            variant={viewType === 'table' ? 'outline' : 'ghost'}
            aria-label="List view"
            aria-pressed={viewType === 'table'}
            icon={<ListIcon size={18} />}
            onClick={() => {
              setViewType('table')
            }}
          />
          <IconButton
            variant={viewType === 'grid' ? 'outline' : 'ghost'}
            aria-label="Card view"
            aria-pressed={viewType === 'grid'}
            icon={<Grid2X2Icon size={18} />}
            onClick={() => {
              setViewType('grid')
            }}
          />
        </Flex>
        {viewType === 'grid' ? (
          <StatementsGrid statements={statements} canDelete />
        ) : (
          <StatementsTable statements={statements} />
        )}
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
}): JSX.Element {
  const description =
    descriptionVersion === 'empty-state'
      ? 'A clear record of your Bitcoin holdings.'
      : 'View and download your saved Bitcoin statements.'

  return (
    <Stack gap={6} mb={6}>
      <Flex
        justifyContent="space-between"
        align={{ base: 'stretch', sm: 'center' }}
        direction={{ base: 'column', sm: 'row' }}
        gap={4}
      >
        <PageHeading title="Statements" description={description} flexGrow={1} />
        {showGenerateButton && (
          <Button as={RouterLink} to="/statements/create" state={{ returnTo: '/statements' }} w="fit-content">
            Generate Statement
          </Button>
        )}
      </Flex>
      {!hideDivider && <chakra.hr />}
    </Stack>
  )
}
