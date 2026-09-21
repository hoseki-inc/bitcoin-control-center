import { Avatar, AvatarBadge, type AvatarBadgeProps, type AvatarProps, Flex } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export type KeystoreAvatarProps = {
  /**
   * The variant of the avatar, it affects multiple aspects of the avatar:
   * - `contained` - Default size is 36px, has padding for the image, border and white background
   * - `filled` - Default size is 44px, without any padding for the image, no border, light grey background
   * @default 'contained'
   */
  variant?: 'contained' | 'filled'
  size?: AvatarProps['size']
} & CommonProps

export function KeystoreAvatar({ variant = 'contained', ...props }: KeystoreAvatarProps): JSX.Element {
  return variant === 'contained' ? <ContainedAvatar {...props} /> : <FilledAvatar {...props} />
}

interface CommonProps extends Omit<AvatarProps, 'onError'> {
  alt?: string
}

function ContainedAvatar({ sx, size = '36px', ...props }: CommonProps) {
  return (
    <Avatar
      borderWidth="1px"
      borderColor="neutral.200"
      bg="shades.0"
      width={size}
      height={size}
      onError={() => {}}
      sx={{
        ...sx,
        '& > *:first-of-type': {
          borderRadius: 'none',
          objectFit: 'contain',
          padding: '22.22%',
        },
      }}
      {...props}
    />
  )
}

function FilledAvatar({ sx, size = '44px', ...props }: CommonProps) {
  return (
    <Avatar
      bg="neutral.50"
      width={size}
      height={size}
      onError={() => {}}
      sx={{
        ...sx,
        '& > *:first-of-type': {
          borderRadius: 'none',
          objectFit: 'contain',
          padding: '9%',
        },
      }}
      {...props}
    />
  )
}

function KeystoreAvatarBadge(props: AvatarBadgeProps) {
  return <AvatarBadge boxSize={'16px'} border="none" bottom="6%" {...props} />
}

KeystoreAvatar.Badge = KeystoreAvatarBadge

function KeystoreAvatarGroup({ children }: { children: ReactNode }) {
  const marginLeft = '6px'
  return (
    <Flex justifyContent="center">
      {/* Vini:
        - AvatarGroup didn't work well
        - although we are already sorting, flexDirection and order are used to avatar stacking work
        */}
      <Flex
        position="relative"
        ml={marginLeft}
        flexDirection="row-reverse"
        sx={{
          '& > *': {
            marginLeft: `-${marginLeft}`,
          },
        }}
      >
        {children}
      </Flex>
    </Flex>
  )
}

KeystoreAvatar.Group = KeystoreAvatarGroup
