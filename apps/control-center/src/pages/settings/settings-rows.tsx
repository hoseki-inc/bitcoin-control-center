import { Box, Flex, Stack, Text } from '@chakra-ui/react'
import { type LucideIcon } from 'lucide-react'
import { type ReactNode } from 'react'

/**
 * Icon tile tones run from the Hoseki yellow down through amber, so a column of rows
 * reads as one family, the way the dock does.
 */
const TONES: ReadonlyArray<{ from: string; to: string; glyph: string }> = [
  { from: '#FFF0A3', to: '#FFD84A', glyph: '#3A2A00' },
  { from: '#FFE27A', to: '#F4B92E', glyph: '#3A2A00' },
  { from: '#FDCB5C', to: '#E39A1E', glyph: '#2E1D00' },
  { from: '#F7B14B', to: '#C97812', glyph: '#FFFFFF' },
  { from: '#E8983C', to: '#A85E0D', glyph: '#FFFFFF' },
  { from: '#D17F31', to: '#8A4A0A', glyph: '#FFFFFF' },
]

export function SettingsTile({ icon: Icon, tone }: { icon: LucideIcon; tone: number }): JSX.Element {
  const { from, to, glyph } = TONES[tone % TONES.length] ?? { from: '#FFE56C', to: '#F2B200', glyph: '#3A2A00' }
  return (
    <Flex
      boxSize="30px"
      flexShrink={0}
      align="center"
      justify="center"
      borderRadius="8px"
      bg={`linear-gradient(180deg, rgb(255 255 255 / 0.18), rgb(0 0 0 / 0.12)), linear-gradient(160deg, ${from}, ${to})`}
      border="1px solid rgb(255 255 255 / 0.25)"
      boxShadow="inset 0 1px 0 rgb(255 255 255 / 0.28), 0 1px 2px rgb(0 0 0 / 0.15)"
      color={glyph}
    >
      <Icon size={16} strokeWidth={2.25} aria-hidden />
    </Flex>
  )
}

/** A rounded glass group of rows, with an optional quiet label above it. */
export function SettingsGroup({ label, children }: { label?: string; children: ReactNode }): JSX.Element {
  return (
    <Box as="section" aria-label={label}>
      {label !== undefined && (
        <Text px={1} mb={2} textStyle="text/xs" fontWeight="semibold" color="text.tertiary" letterSpacing="0.02em">
          {label}
        </Text>
      )}
      <Box
        layerStyle="edge"
        borderRadius="20px"
        overflow="hidden"
        sx={{ '& > * + *': { borderTop: '1px solid', borderColor: 'border.subtle' } }}
      >
        {children}
      </Box>
    </Box>
  )
}

/**
 * One setting: tile, title and description on the left, its control on the right
 * (below on narrow screens). `footer` holds status text or a larger control.
 */
export function SettingsRow({
  icon,
  tone,
  title,
  titleId,
  description,
  descriptionId,
  control,
  footer,
}: {
  icon: LucideIcon
  tone: number
  title: ReactNode
  titleId?: string
  description?: ReactNode
  descriptionId?: string
  control?: ReactNode
  footer?: ReactNode
}): JSX.Element {
  return (
    <Box px={{ base: 4, md: 5 }} py={4} minH="72px">
      <Flex
        direction={{ base: 'column', md: 'row' }}
        align={{ base: 'stretch', md: 'center' }}
        justify="space-between"
        gap={{ base: 3, md: 6 }}
      >
        <Flex align="center" gap={3} minW={0}>
          <SettingsTile icon={icon} tone={tone} />
          <Stack spacing={0.5} minW={0}>
            <Text id={titleId} textStyle="text/sm" fontWeight="semibold" color="text.primary">
              {title}
            </Text>
            {description !== undefined && (
              <Text id={descriptionId} textStyle="text/xs" color="text.secondary">
                {description}
              </Text>
            )}
          </Stack>
        </Flex>
        {control !== undefined && (
          <Box flexShrink={0} alignSelf={{ base: 'flex-start', md: 'center' }} maxW="100%">
            {control}
          </Box>
        )}
      </Flex>
      {footer !== undefined && <Box mt={3}>{footer}</Box>}
    </Box>
  )
}
