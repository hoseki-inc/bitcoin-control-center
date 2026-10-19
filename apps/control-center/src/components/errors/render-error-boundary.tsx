import { Button, HStack, Stack } from '@chakra-ui/react'
import { ErrorBlock } from '@hoseki/packages/ui/design-system'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { browserLogger } from '../../logger'

type BoundaryProps = { pathname: string; children: ReactNode }
type BoundaryState = { hasError: boolean; errorPathname: string | null }

const noError: BoundaryState = { hasError: false, errorPathname: null }
const HOME_PATH = '/home'

class Boundary extends Component<BoundaryProps, BoundaryState> {
  public override state: BoundaryState = noError

  public static getDerivedStateFromError(): Partial<BoundaryState> {
    return { hasError: true }
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    browserLogger.error({ err: error, componentStack: info.componentStack }, 'Render error')
    this.setState({ errorPathname: this.props.pathname })
  }

  public override componentDidUpdate(): void {
    // Compare with the path that failed, not the previous path: the catch can land in the same update as the navigation.
    const { errorPathname } = this.state
    if (errorPathname !== null && errorPathname !== this.props.pathname) {
      this.setState(noError)
    }
  }

  public override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }
    return (
      <Stack align="center" gap={6} py={[32, 48]} px={6}>
        <ErrorBlock titleAs="h1" title="Something went wrong" description="This page couldn't be displayed." />
        <HStack>
          <Button
            as={Link}
            to={HOME_PATH}
            variant="outline"
            onClick={() => {
              // Only on Home itself: elsewhere the path change clears the error, and clearing it here first
              // would draw the broken page again before the router's lower-priority navigation reaches Home.
              if (this.props.pathname === HOME_PATH) {
                this.setState(noError)
              }
            }}
          >
            Back to Home
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.reload()
            }}
          >
            Reload
          </Button>
        </HStack>
      </Stack>
    )
  }
}

/** Shows a way back instead of a blank window when a page throws while rendering. */
export function RenderErrorBoundary({ children }: { children: ReactNode }): JSX.Element {
  const { pathname } = useLocation()
  return <Boundary pathname={pathname}>{children}</Boundary>
}
