import { Box, type BoxProps, HStack, Text } from '@chakra-ui/react'

const styles = {
  neutral: {
    header: {
      bgColor: 'surface.subtle',
      color: 'text.secondary',
      borderBottom: 'solid 1px',
      borderColor: 'border.subtle',
    },
  },
  warning: {
    header: {
      bgColor: 'status.warning.bg',
      color: 'status.warning.fg',
    },
  },
} as const

type ColorMode = keyof typeof styles

type BasePanelProps = BoxProps & { children: React.ReactNode; colorMode?: ColorMode }

type CustomHeaderPanelProps = BasePanelProps & {
  customHeader: React.ReactNode
  title?: never
  icon?: never
}

type StandardPanelProps = BasePanelProps & {
  title: string
  icon?: React.ReactNode
  customHeader?: never
}

export type PanelProps = CustomHeaderPanelProps | StandardPanelProps

export function Panel(props: PanelProps): JSX.Element {
  const { children, colorMode = 'neutral', customHeader, title, icon, ...rest } = props

  return (
    <Box as="section" border="solid 1px" borderColor="border.subtle" borderRadius="panel" {...rest}>
      {customHeader ?? <Header icon={icon} title={title ?? ''} colorMode={colorMode} />}
      {children}
    </Box>
  )
}

function Header({
  icon,
  title,
  colorMode,
  rightContent,
}: {
  icon: React.ReactNode
  title: string
  colorMode: ColorMode
  rightContent?: React.ReactNode
}) {
  return (
    <HStack as="header" px={6} py={4} borderTopRadius="panel" {...styles[colorMode].header}>
      {icon}
      <Text as="h1" textStyle="text/md" fontWeight="medium">
        {title}
      </Text>
      <HStack ml="auto" gap={2}>
        {rightContent}
      </HStack>
    </HStack>
  )
}

Panel.Header = Header
