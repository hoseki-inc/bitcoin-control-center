import { Box, chakra } from '@chakra-ui/react'

export function FloatingKeystoneImage(): JSX.Element {
  return (
    <Box mx="auto" pt={10} pb={6}>
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
