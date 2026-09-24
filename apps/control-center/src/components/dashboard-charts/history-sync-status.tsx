import { Box, Spinner, Tooltip } from '@chakra-ui/react'
import { motion } from '@hoseki/packages/ui/design-system/animations/motion'
import { CheckCircleFilledIcon } from '@hoseki/packages/ui/prove-verify-ui/icons/check-circle-filled'

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
  const transition = `opacity ${label ? motion.statusMs : motion.dismissMs}ms ease`

  return (
    <Tooltip label={label} isDisabled={!label} openDelay={250} hasArrow>
      <Box
        as="output"
        display="block"
        aria-label={label}
        position="relative"
        flexShrink={0}
        ml={compact ? 0 : 0.5}
        w={size}
        h={size}
      >
        <Box position="absolute" inset={0} opacity={syncing ? 1 : 0} transition={transition} aria-hidden="true">
          <Spinner
            label=""
            size="xs"
            color="text.secondary"
            w={size}
            h={size}
            // Hidden spinners remain still; only real work gets continuous motion.
            sx={syncing ? undefined : { animation: 'none' }}
          />
        </Box>
        <Box position="absolute" inset={0} opacity={complete ? 1 : 0} transition={transition} aria-hidden="true">
          <CheckCircleFilledIcon color="text.secondary" color2="text.inverse" boxSize={size} />
        </Box>
      </Box>
    </Tooltip>
  )
}
