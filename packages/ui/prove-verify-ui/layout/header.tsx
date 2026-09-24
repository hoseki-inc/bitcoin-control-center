import { Box, chakra } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Wrapper } from '.'

interface MenuItem {
  to: string
  title: string
}

interface MenuProps {
  items: MenuItem[]
  renderLink: (to: string, children: ReactNode) => ReactNode
}

export function MenuItemComponent({
  to,
  title,
  renderLink,
}: MenuItem & { renderLink: MenuProps['renderLink'] }): JSX.Element {
  return (
    <chakra.li
      listStyleType="none"
      display="inline-block"
      flex={{ base: 1, md: 'initial' }}
      textStyle="text/sm"
      fontWeight="medium"
      color="text.secondary"
      sx={{
        '& > a': {
          display: 'flex',
          alignItems: 'center',
          minHeight: '44px',
          px: { base: 1, sm: 2, md: 4 },
          justifyContent: 'center',
          borderRadius: 'control',
          transition: 'background-color 150ms ease, color 150ms ease',
        },
        '& > a:hover': { bg: 'surface.muted', color: 'text.primary' },
        '& > a[aria-current="page"]': { bg: 'surface.muted', color: 'text.primary' },
      }}
    >
      {renderLink(to, title)}
    </chakra.li>
  )
}

export function Menu({ items, renderLink }: MenuProps): JSX.Element {
  return (
    <chakra.ul display="flex" gap={1} m={0} p={0}>
      {items.map((item) => (
        <MenuItemComponent key={item.to} {...item} renderLink={renderLink} />
      ))}
    </chakra.ul>
  )
}

export interface HeaderProps {
  logo: ReactNode
  menu: ReactNode
  userInfo: ReactNode
}

export function Header({ logo, menu, userInfo }: HeaderProps): JSX.Element {
  return (
    <Box as="header" borderBottom="1px solid" borderColor="border.subtle" bg="surface.base">
      <Wrapper display="flex" alignItems="center" flexWrap="wrap" maxW="928px" gap={{ base: 2, md: 6 }} py={3}>
        {logo}
        <Box
          as="nav"
          aria-label="Main navigation"
          flexGrow="1"
          minW={0}
          order={{ base: 3, md: 0 }}
          w={{ base: '100%', md: 'auto' }}
          overflowX="auto"
          py={1}
          px={1}
          mx={-1}
        >
          {menu}
        </Box>
        <Box ml="auto">{userInfo}</Box>
      </Wrapper>
    </Box>
  )
}
