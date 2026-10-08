import { Box, Spinner, Tooltip, VisuallyHidden } from '@chakra-ui/react'
import { motion } from '@hoseki/packages/ui/design-system/animations/motion'
import { CheckCircleFilledIcon } from '@hoseki/packages/ui/prove-verify-ui/icons/check-circle-filled'

// The check eases in, shows briefly, then fades slowly; the spinner stays quick.
const CHECK_IN_MS = 400
const CHECK_OUT_MS = 1500

export function HistorySyncStatus({
  syncing,
  synced,
  compact,
}: {
  syncing: boolean
  synced: boolean
  compact: boolean
}): JSX.Element {
  const complete = !syncing && synced
  const label = syncing ? 'Updating history' : complete ? 'History updated' : undefined
  const size = compact ? '12px' : '14px'
  const spinnerTransition = `opacity ${label ? motion.statusMs : motion.dismissMs}ms ease`
  const checkTransition = complete ? `opacity ${CHECK_IN_MS}ms ease-out` : `opacity ${CHECK_OUT_MS}ms ease-in-out`

  return (
    <Tooltip label={label} isDisabled={!label} openDelay={250} hasArrow>
      <Box as="span" display="block" position="relative" flexShrink={0} ml={compact ? 0 : 0.5} w={size} h={size}>
        <Box
          as="span"
          display="block"
          position="absolute"
          inset={0}
          opacity={syncing ? 1 : 0}
          transition={spinnerTransition}
          aria-hidden="true"
        >
          <Spinner
            as="span"
            label=""
            size="xs"
            color="neutral.600"
            w={size}
            h={size}
            // Hidden spinners remain still; only real work gets continuous motion.
            sx={syncing ? undefined : { animation: 'none' }}
          />
        </Box>
        <Box
          as="span"
          display="block"
          position="absolute"
          inset={0}
          opacity={complete ? 1 : 0}
          transition={checkTransition}
          aria-hidden="true"
        >
          <CheckCircleFilledIcon color="success.600" color2="white" boxSize={size} />
        </Box>
        {/* Read as part of the account's button; the page header announces sync changes. */}
        {label !== undefined && <VisuallyHidden>{label}</VisuallyHidden>}
      </Box>
    </Tooltip>
  )
}
