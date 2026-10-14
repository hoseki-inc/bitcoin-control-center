import { Box, CloseButton, HStack, Link, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { baseTrpc } from '../../trpc'

const DOWNLOAD_URL = 'https://www.bitcoincontrolcenter.com/#downloads'
// Only asks the local Sentinel. While its launch check is still running, ask again soon so a short
// session still sees the result; after that, Sentinel checks about once a day and hourly is enough.
const PENDING_REFRESH_MS = 3000
const REFRESH_MS = 60 * 60 * 1000
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

// Kept outside React: the app's page groups each mount their own layout, so moving between them
// remounts the notice. A dismissed notice stays hidden for the rest of the app session, until the
// app starts again or a newer release is found.
let dismissedVersion: string | null = null

/** Whether keyboard focus can return to this control: still in the page, shown and enabled. */
function canTakeFocus(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    element.getClientRects().length > 0 &&
    !element.matches(':disabled')
  )
}

/** The last focusable control before the notice, where Shift+Tab from the notice would go. */
function controlBefore(notice: Element): HTMLElement | null {
  const before = [...document.querySelectorAll(FOCUSABLE)].filter(
    (element) =>
      !notice.contains(element) && (element.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  )
  return before.reverse().find(canTakeFocus) ?? null
}

/** A notice at the bottom of the window when a newer desktop release is out. */
export function ReleaseNotice(): JSX.Element {
  const { data } = useQuery({
    queryKey: ['release-check'],
    queryFn: async ({ signal }) => baseTrpc.settings.releaseCheck.query(undefined, { signal }),
    refetchInterval: (status) => (status?.pending === false ? REFRESH_MS : PENDING_REFRESH_MS),
  })
  const [dismissed, setDismissed] = useState(dismissedVersion)
  const region = useRef<HTMLOutputElement>(null)
  // The control that had focus before the keyboard moved into the notice.
  const focusedBefore = useRef<Element | null>(null)
  const version = data?.newVersion ?? null
  const shown = version !== null && version !== dismissed

  // After a keyboard dismissal the focused button disappears: return to where the user came from, or
  // failing that to the control just before the notice, rather than leaving focus on the page body.
  const restoreFocus = (): void => {
    const previous = focusedBefore.current
    const target =
      previous !== null && canTakeFocus(previous) ? previous : region.current && controlBefore(region.current)
    target?.focus()
  }

  // The live region stays mounted and empty, so screen readers announce the notice when it is filled.
  return (
    <Box as="output" ref={region}>
      {shown && (
        <HStack
          position="fixed"
          bottom={4}
          left="50%"
          transform="translateX(-50%)"
          maxW="calc(100% - 32px)"
          zIndex={100}
          spacing={3}
          bg="shades.0"
          border="1px solid"
          borderColor="neutral.200"
          borderRadius="full"
          boxShadow="md"
          pl={4}
          pr={2}
          py={1.5}
          onFocus={(event) => {
            const from = event.relatedTarget
            if (from !== null && !event.currentTarget.contains(from)) {
              focusedBefore.current = from
            }
          }}
        >
          <Text textStyle="text/sm" color="neutral.900">
            Bitcoin Control Center {version} is available.
          </Text>
          <Link href={DOWNLOAD_URL} isExternal textStyle="text/sm" fontWeight="semibold" color="warning.700">
            Download
          </Link>
          <CloseButton
            size="sm"
            color="neutral.500"
            borderRadius="full"
            aria-label="Dismiss"
            onClick={(event) => {
              dismissedVersion = version
              setDismissed(version)
              // Enter or Space gives a click with no pointer clicks; a mouse user's focus is left alone.
              if (event.detail === 0) {
                restoreFocus()
              }
            }}
          />
        </HStack>
      )}
    </Box>
  )
}
