import { Box, chakra } from '@chakra-ui/react'

export function FloatingKeystoneImage(): JSX.Element {
  return (
    <Box
      mx="auto"
      pt={10}
      pb={6}
      sx={{
        animation: 'float 4s ease-in-out infinite',
        '@keyframes float': {
          '0%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
          '100%': { transform: 'translateY(0)' },
        },
      }}
    >
      <chakra.img
        src="/images/hardware-wallets/keystone-device.png"
        alt="Keystone"
        h="300px"
        display="block"
        filter="drop-shadow(-8px 10px 15px rgba(0, 0, 0, 0.5))"
      />
    </Box>
  )
}
