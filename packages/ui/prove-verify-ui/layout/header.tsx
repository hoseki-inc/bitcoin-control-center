import { Box, chakra } from '@chakra-ui/react'
import { type ReactNode } from 'react'
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
      px={4}
      py={2.5}
      listStyleType="none"
      display="inline-block"
      textStyle="text/sm"
      fontWeight="600"
      color="neutral.900"
      _hover={{ color: 'neutral.500' }}
    >
      {renderLink(to, title)}
    </chakra.li>
  )
}

export function Menu({ items, renderLink }: MenuProps): JSX.Element {
  return (
    <chakra.ul fontSize={16}>
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
    <Box borderBottom="1px solid" borderColor="neutral.200">
      <Wrapper display="flex" alignItems="center" maxW="928px" gap={10} py={3}>
        {logo}
        <Box flexGrow="1">{menu}</Box>
        {userInfo}
      </Wrapper>
    </Box>
  )
}
