import { Box, type BoxProps, chakra } from '@chakra-ui/react'

/** The Bitkey render, gently floating. Children float with it, positioned against the image. */
export function FloatingBitkeyImage({
  imageHeight = '200px',
  children,
  ...props
}: { imageHeight?: string } & BoxProps): JSX.Element {
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
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
      {...props}
    >
      <Box position="relative">
        <chakra.img
          src="/images/hardware-wallets/bitkey-device.png"
          alt="Bitkey"
          h={imageHeight}
          display="block"
          filter="drop-shadow(-8px 10px 15px rgba(0, 0, 0, 0.5))"
        />
        {children}
      </Box>
    </Box>
  )
}
