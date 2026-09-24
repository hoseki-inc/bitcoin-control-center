import { Box, HStack, Stack, type StackProps, Text, createIcon } from '@chakra-ui/react'

export type ErrorVariant = 'error' | 'warning' | 'neutral'

const colorMap = {
  error: {
    color: 'status.error.fg',
    backgroundColor: 'status.error.bg',
    borderColor: 'status.error.border',
  },
  warning: {
    color: 'status.warning.fg',
    backgroundColor: 'status.warning.bg',
    borderColor: 'status.warning.border',
  },
  neutral: {
    color: 'text.primary',
    backgroundColor: 'surface.muted',
    borderColor: 'border.subtle',
  },
} as const

export type ErrorBlockProps = {
  title: string
  description: string
  variant?: ErrorVariant
} & StackProps
export function ErrorBlock({ title, description, variant = 'error', ...rest }: ErrorBlockProps): JSX.Element {
  const { color } = colorMap[variant]

  return (
    <Stack
      role={variant === 'error' ? 'alert' : 'status'}
      alignItems="center"
      textAlign="center"
      gap={2}
      color={color}
      {...rest}
    >
      <WarningTriangleFilledIcon boxSize="37px" />
      <Text textStyle="text/lg" fontWeight="medium">
        {title}
      </Text>
      <Text textStyle="text/md">{description}</Text>
    </Stack>
  )
}

export type ErrorBannerProps = {
  message: React.ReactNode
  variant?: ErrorVariant
  rightContent?: React.ReactNode
} & StackProps

export function ErrorBanner({ message, variant = 'error', rightContent, ...rest }: ErrorBannerProps): JSX.Element {
  const { color, backgroundColor, borderColor } = colorMap[variant]

  return (
    <HStack
      role={variant === 'error' ? 'alert' : 'status'}
      alignItems={{ base: 'stretch', sm: 'center' }}
      flexDirection={{ base: 'column', sm: 'row' }}
      gap={3}
      bg={backgroundColor}
      border="1px solid"
      borderColor={borderColor}
      borderRadius="8px"
      px={4}
      py={2}
      color={color}
      {...rest}
    >
      <HStack flexGrow={1} minW={0} align="start" py={2}>
        <WarningCircleFilledIcon boxSize="16px" flexShrink={0} mt="2px" aria-hidden="true" />
        <Text textStyle="text/sm" fontWeight="medium" overflowWrap="anywhere">
          {message}
        </Text>
      </HStack>
      {rightContent}
    </HStack>
  )
}

export type ErrorInlineProps = {
  title: string
  message: string
  variant?: ErrorVariant
  otherContent?: React.ReactNode
} & StackProps
export function ErrorInline({
  title,
  message,
  variant = 'error',
  otherContent,
  ...rest
}: ErrorInlineProps): JSX.Element {
  const { color, backgroundColor, borderColor } = colorMap[variant]

  return (
    <Stack
      role={variant === 'error' ? 'alert' : 'status'}
      overflowWrap="anywhere"
      gap={2}
      bg={backgroundColor}
      border="1px solid"
      borderColor={borderColor}
      borderRadius="8px"
      px={4}
      py={2}
      {...rest}
    >
      <HStack>
        <WarningCircleFilledIcon color={color} boxSize="14px" />
        <Text textStyle="text/sm" fontWeight="medium" color={color}>
          {title}
        </Text>
      </HStack>
      <Text textStyle="text/sm" color="text.primary" fontWeight="medium">
        {message}
      </Text>
      {Boolean(otherContent) ? <Box color="text.primary">{otherContent}</Box> : otherContent}
    </Stack>
  )
}

const WarningTriangleFilledIcon = createIcon({
  displayName: 'WarningTriangleFilledIcon',
  viewBox: '0 0 37 37',
  path: (
    <>
      <path
        d="M33.5005 27.7499L21.1672 6.16661C20.8982 5.69209 20.5083 5.2974 20.037 5.0228C19.5657 4.7482 19.0301 4.60352 18.4847 4.60352C17.9392 4.60352 17.4036 4.7482 16.9323 5.0228C16.4611 5.2974 16.0711 5.69209 15.8022 6.16661L3.46882 27.7499C3.197 28.2207 3.05447 28.755 3.05567 29.2986C3.05688 29.8422 3.20177 30.3758 3.47568 30.8453C3.74958 31.3149 4.14276 31.7037 4.61535 31.9723C5.08795 32.2409 5.62316 32.3798 6.16674 32.3749H30.8334C31.3744 32.3744 31.9057 32.2315 32.374 31.9607C32.8423 31.6898 33.231 31.3005 33.5013 30.8319C33.7715 30.3633 33.9137 29.8318 33.9136 29.2908C33.9134 28.7498 33.771 28.2184 33.5005 27.7499Z"
        fill="currentColor"
      />
      <path
        d="M18.5 13.875V20.0417"
        stroke="white"
        strokeWidth="1.92708"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 26.209H18.5154"
        stroke="white"
        strokeWidth="1.92708"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
})

const WarningCircleFilledIcon = createIcon({
  displayName: 'WarningCircleFilledIcon',
  viewBox: '0 0 16 16',
  path: (
    <>
      <path
        d="M8.00065 14.6663C11.6825 14.6663 14.6673 11.6816 14.6673 7.99967C14.6673 4.31778 11.6825 1.33301 8.00065 1.33301C4.31875 1.33301 1.33398 4.31778 1.33398 7.99967C1.33398 11.6816 4.31875 14.6663 8.00065 14.6663Z"
        fill="currentColor"
      />
      <path d="M8 5.33301V7.99967" stroke="#FFEFF0" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10.667H8.00667" stroke="#FFEFF0" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
})
