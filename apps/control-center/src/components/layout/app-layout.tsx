import { Box } from '@chakra-ui/react'
import { motion } from '@hoseki/packages/ui/design-system/animations/motion'
import {
  AppLayout as BaseAppLayout,
  Logo as BaseLogo,
  Menu as BaseMenu,
  Header,
  getEnvSlug,
} from '@hoseki/packages/ui/prove-verify-ui'
import { Link, NavLink, Outlet } from 'react-router'
import { UserInfo } from './user-info'

const HOSEKI_ENV = import.meta.env['VITE_HOSEKI_ENV']

const menuItems = [
  { to: '/home', title: 'Home' },
  { to: '/accounts', title: 'Accounts' },
  { to: '/portfolio', title: 'Portfolio' },
  { to: '/statements', title: 'Statements' },
]

export function AppLayout({ fullWidth }: { fullWidth?: boolean }): JSX.Element {
  const logoLink = '/home'

  const logo = (
    <BaseLogo
      logoSrc="/hoseki-logo.svg"
      logoAlt="Bitcoin Control Center"
      renderLink={(children) => <Link to={logoLink}>{children}</Link>}
      stickerLabel={getEnvSlug(HOSEKI_ENV)}
    />
  )

  const menu = <BaseMenu items={menuItems} renderLink={(to, children) => <NavLink to={to}>{children}</NavLink>} />

  const header = (
    <Box data-app-navbar>
      <Header logo={logo} menu={menu} userInfo={<UserInfo />} />
    </Box>
  )

  return (
    <Box
      display="contents"
      sx={{
        '& [data-app-navbar]': {
          opacity: 1,
          visibility: 'visible',
          transition: `opacity 260ms ${motion.easeOut}`,
        },
        // Fade in alongside the content as soon as the welcome enters its reveal phase.
        '&:has([data-welcome-phase="welcome"]) [data-app-navbar]': {
          opacity: 0,
          visibility: 'hidden',
          transition: 'none',
        },
        '@media (prefers-reduced-motion: reduce)': {
          '& [data-app-navbar]': { transition: 'none' },
        },
      }}
    >
      <BaseAppLayout header={header} fullWidth={fullWidth}>
        <Outlet />
      </BaseAppLayout>
    </Box>
  )
}
