import { Button, Container, Flex, Stack, chakra } from '@chakra-ui/react'
import { Link } from 'react-router'

export function NotFound({ showBackToHome = true }: { showBackToHome?: boolean }): JSX.Element {
  return (
    <Container h="full" gap={8} alignItems="center" py={[32, 48]} textAlign="center" maxW="container.sm">
      <Stack gap={4}>
        <chakra.h1 textStyle={['text/2xl', 'text/4xl']} fontWeight="bold">
          Page not found
        </chakra.h1>
        <chakra.p textStyle="text/lg" fontWeight="medium">
          Sorry, we can&apos;t find the page you&apos;re looking for.
        </chakra.p>
        {showBackToHome && (
          <Flex justify="center">
            <Button as={Link} variant="outline" to={'/'} size={['md', 'lg']}>
              Back to Home
            </Button>
          </Flex>
        )}
      </Stack>
    </Container>
  )
}
