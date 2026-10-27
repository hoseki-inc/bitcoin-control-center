import { Box, HStack, Icon, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { ChevronRightIcon, SettingsIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Where to find the descriptor in the Bitkey app, drawn as simple phones.
 * Rows we don't name are grey bars, so the drawings don't go stale when Bitkey reorders its menus;
 * the named labels are Bitkey's own (Settings → Exports → Current wallet descriptor → Download XPUB bundle).
 */
export function BitkeyPhoneSteps(): JSX.Element {
  return (
    <SimpleGrid as="ol" columns={{ base: 2, md: 4 }} spacingX={4} spacingY={6} listStyleType="none">
      <PhoneStep number={1} caption="Open the Bitkey app and tap Settings.">
        <ScreenTitle
          trailing={
            <TapTarget>
              <Icon as={SettingsIcon} boxSize={3} color="neutral.900" display="block" />
            </TapTarget>
          }
        />
        <Stack gap={1} pt={2}>
          <Bar w="40%" />
          <Bar w="70%" h={3} />
        </Stack>
        <Stack gap={1.5} pt={4}>
          <Bar w="full" h={6} />
          <Bar w="full" h={6} />
        </Stack>
      </PhoneStep>

      <PhoneStep number={2} caption="Tap Exports.">
        <ScreenTitle title="Settings" />
        <Stack gap={1.5} pt={2}>
          <Row />
          <Row />
          <Row label="Exports" isTapped />
          <Row />
        </Stack>
      </PhoneStep>

      <PhoneStep number={3} caption="Tap Current wallet descriptor.">
        <ScreenTitle title="Exports" />
        <Stack gap={1.5} pt={2}>
          <Row label="Transaction history" detail="Export CSV" />
          <Row label="Current wallet descriptor" detail="Export XPUB bundle" isTapped />
        </Stack>
      </PhoneStep>

      <PhoneStep number={4} caption="Tap Download XPUB bundle and send it to this computer.">
        <ScreenTitle title="Exports" />
        <Stack gap={1.5} pt={2} opacity={0.4}>
          <Row />
          <Row />
        </Stack>
        <Stack
          position="absolute"
          insetX={0}
          bottom={0}
          gap={2}
          p={3}
          pb={5}
          bg="shades.0"
          borderTopRadius="xl"
          borderTopWidth="1px"
          borderColor="neutral.200"
        >
          <Text textStyle="label/sm" fontWeight="semibold" color="neutral.900">
            Export wallet descriptor
          </Text>
          <Bar w="80%" />
          <TapTarget display="block">
            <Box bg="neutral.900" borderRadius="md" py={1.5} textAlign="center">
              <Text textStyle="label/xs" fontWeight="medium" color="shades.0">
                Download XPUB bundle
              </Text>
            </Box>
          </TapTarget>
        </Stack>
      </PhoneStep>
    </SimpleGrid>
  )
}

function PhoneStep({ number, caption, children }: { number: number; caption: string; children: ReactNode }) {
  return (
    <Stack as="li" gap={3} align="center">
      <Box
        aria-hidden
        position="relative"
        w="full"
        maxW="136px"
        sx={{ aspectRatio: '9 / 18.5' }}
        borderWidth="5px"
        borderColor="neutral.900"
        borderRadius="24px"
        bg="neutral.50"
        overflow="hidden"
        px={3}
        pt={6}
      >
        <Box
          position="absolute"
          top={1.5}
          left="50%"
          transform="translateX(-50%)"
          w={8}
          h={1.5}
          borderRadius="full"
          bg="neutral.900"
        />
        {children}
      </Box>
      <HStack align="start" gap={2} maxW="136px">
        <Text textStyle="label/sm" fontWeight="semibold" color="neutral.900">
          {number}
        </Text>
        <Text textStyle="label/sm" color="neutral.700">
          {caption}
        </Text>
      </HStack>
    </Stack>
  )
}

function ScreenTitle({ title, trailing }: { title?: string; trailing?: ReactNode }) {
  return (
    <HStack justify="space-between" minH={5}>
      {title === undefined ? (
        <Bar w="35%" />
      ) : (
        <Text textStyle="label/sm" fontWeight="semibold" color="neutral.900">
          {title}
        </Text>
      )}
      {trailing}
    </HStack>
  )
}

function Row({ label, detail, isTapped = false }: { label?: string; detail?: string; isTapped?: boolean }) {
  const row = (
    <HStack justify="space-between" bg="shades.0" borderRadius="md" px={2} py={1.5} minH={7} gap={1}>
      {label === undefined ? (
        <Bar w="55%" />
      ) : (
        <Stack gap={0} minW={0}>
          <Text textStyle="label/xs" fontWeight="medium" color="neutral.900">
            {label}
          </Text>
          {detail !== undefined && (
            <Text textStyle="label/xs" color="neutral.500">
              {detail}
            </Text>
          )}
        </Stack>
      )}
      <Icon as={ChevronRightIcon} boxSize={3} color="neutral.400" flexShrink={0} />
    </HStack>
  )
  return isTapped ? <TapTarget display="block">{row}</TapTarget> : row
}

/** Rings the thing to tap, like a fingertip on the screen. */
function TapTarget({
  children,
  display = 'inline-block',
}: {
  children: ReactNode
  display?: 'block' | 'inline-block'
}) {
  return (
    <Box display={display} borderRadius="lg" p="1px" borderWidth="2px" borderColor="neutral.900">
      {children}
    </Box>
  )
}

function Bar({ w, h = 2 }: { w: string; h?: number }) {
  return <Box w={w} h={h} borderRadius="sm" bg="neutral.200" />
}
