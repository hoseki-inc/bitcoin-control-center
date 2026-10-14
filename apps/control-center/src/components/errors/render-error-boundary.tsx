import { Button, HStack, Stack } from '@chakra-ui/react'
import { ErrorBlock } from '@hoseki/packages/ui/design-system'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { browserLogger } from '../../logger'

type BoundaryProps = { pathname: string; children: ReactNode }
type BoundaryState = { hasError: boolean; errorPathname: string | null }

const noError: BoundaryState = { hasError: false, errorPathname: null }

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
      <Stack align="center" gap={6} py={16} px={6}>
        <ErrorBlock title="Something went wrong" description="This page couldn't be displayed." />
        <HStack>
          <Button
            as={Link}
            to="/home"
            variant="outline"
            onClick={() => {
              // Clears the error when it happened on Home itself, where the path does not change.
              this.setState(noError)
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
