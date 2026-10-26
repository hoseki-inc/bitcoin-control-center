import { Box, Button, Flex, type FlexProps, Text } from '@chakra-ui/react'

/** Says that data could not be loaded, so the page never passes it off as empty, and offers a retry. */
export function UnavailableAlert({
  title,
  description,
  onRetry,
  ...props
}: FlexProps & { title: string; description: string; onRetry: () => void }): JSX.Element {
  return (
    <Flex
      role="alert"
      align="start"
      justify="space-between"
      gap={4}
      p={4}
      bg="neutral.50"
      borderRadius="control"
      flexWrap="wrap"
      {...props}
    >
      <Box flex="1" minW="200px">
        <Text textStyle="text/sm" fontWeight="medium">
          {title}
        </Text>
        <Text textStyle="text/sm" color="neutral.600" mt={1}>
          {description}
        </Text>
      </Box>
      <Button variant="outline" onClick={onRetry}>
        Try Again
      </Button>
    </Flex>
  )
}
