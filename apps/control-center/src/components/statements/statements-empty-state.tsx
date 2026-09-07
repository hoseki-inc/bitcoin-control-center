import { Box, Button } from '@chakra-ui/react'
import { EmptyView } from '@hoseki/packages/ui/design-system'
import { Link } from 'react-router'

export function StatementsEmptyState(): JSX.Element {
  return (
    <Box border="1px solid" borderColor="neutral.200" borderRadius="panel" bgGradient="linear(to-b, neutral.50, white)">
      <EmptyView
        title="Your first statement starts here"
        description="Create a statement of your Bitcoin holdings. Your generated statements will be saved here, ready to view or download."
        action={
          <Button as={Link} to="/statements/create">
            Generate Statement
          </Button>
        }
      />
    </Box>
  )
}
