import { Box, Image, Stack, Text, useColorModeValue } from '@chakra-ui/react'
import { useLocalSetting } from '../hooks/use-local-settings'

export function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The home screen behind every sheet. */
export function Desktop({ covered }: { covered: boolean }): JSX.Element {
  const { data: name } = useLocalSetting('user_name')
  const logo = useColorModeValue('/hoseki-logo.svg', '/hoseki-logo-light.svg')
  const firstName = typeof name === 'string' ? name.trim().split(/\s+/)[0] : ''
  const greeting = `${greetingFor(new Date())}${firstName ? `, ${firstName}` : ''}.`

  return (
    <Box
      position="relative"
      zIndex={1}
      h="100dvh"
      overflowY="auto"
      px={{ base: 4, md: 8 }}
      pt={{ base: 16, md: 20 }}
      pb="120px"
      // Hidden instantly under a sheet, faded back when the sheet closes.
      opacity={covered ? 0 : 1}
      visibility={covered ? 'hidden' : 'visible'}
      transition={covered ? 'none' : 'opacity 150ms ease-out'}
      aria-hidden={covered}
    >
      <Stack align="center" spacing={5}>
        <Image src={logo} alt="Hoseki" h={{ base: '28px', md: '36px' }} />
        <Text
          as="h1"
          textStyle={{ base: 'text/3xl', md: 'text/5xl' }}
          fontWeight="semibold"
          letterSpacing="-0.02em"
          textAlign="center"
          color="text.primary"
          textShadow="0 1px 12px var(--focus-band)"
        >
          {greeting}
        </Text>
      </Stack>
    </Box>
  )
}
