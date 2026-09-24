import { Box, Flex, chakra, useColorModeValue } from '@chakra-ui/react'
import type { PropsWithChildren, ReactNode } from 'react'

interface LogoProps {
  logoSrc?: string
  logoAlt?: string
  logoHeight?: string | number
  stickerLabel?: string
  renderLink?: (children: ReactNode) => ReactNode
}

export function Logo({
  logoSrc,
  logoAlt = 'Bitcoin Control Center',
  logoHeight = '32px',
  stickerLabel,
  renderLink,
}: LogoProps): JSX.Element {
  const themedSrc = useColorModeValue('/hoseki-logo.svg', '/hoseki-logo-light.svg')
  const LogoImage = <chakra.img src={logoSrc ?? themedSrc} alt={logoAlt} h={logoHeight} />
  return (
    <Flex justify="center">
      <Box position="relative">
        {renderLink ? renderLink(LogoImage) : LogoImage}
        {stickerLabel != null && stickerLabel !== '' && <Sticker>{stickerLabel}</Sticker>}
      </Box>
    </Flex>
  )
}

export function IconLogo({
  logoSrc = '/hoseki-logo-box.svg',
  logoAlt = 'Bitcoin Control Center',
  logoHeight = '32px',
  stickerLabel,
  renderLink,
}: LogoProps): JSX.Element {
  const LogoImage = <chakra.img src={logoSrc} alt={logoAlt} h={logoHeight} />

  return (
    <Flex justify="center">
      <Box position="relative" w="auto">
        {renderLink ? renderLink(LogoImage) : LogoImage}
        {stickerLabel != null && stickerLabel !== '' && <Sticker>{stickerLabel}</Sticker>}
      </Box>
    </Flex>
  )
}

export const getEnvSlug = (env: string): string => {
  if (env === 'development') {
    return 'DEV'
  }

  if (env === 'staging') {
    return 'STG'
  }

  return ''
}

export const Sticker = ({ children }: PropsWithChildren): JSX.Element => {
  return (
    <Flex
      position="absolute"
      px={1}
      borderRadius="sm"
      textTransform="uppercase"
      fontWeight="bold"
      textStyle="label/sm"
      right={0}
      top={0}
      transform="translateX(45%) translateY(-45%) rotateZ(15deg)"
      opacity={0.85}
      color="accent.fg"
      bgColor="accent.solid"
      pointerEvents="none"
      border="1px solid"
      borderColor="border.subtle"
    >
      {children}
    </Flex>
  )
}
