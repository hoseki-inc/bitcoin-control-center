import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import {
  AppLayout as BaseAppLayout,
  Logo as BaseLogo,
  Menu as BaseMenu,
  Header,
  getEnvSlug,
} from '@hoseki/packages/ui/prove-verify-ui'
import { Link, Outlet } from 'react-router'
import { z } from 'zod'
import { UserInfo } from './user-info'

const HOSEKI_ENV = parseUnknown(z.string(), import.meta.env['VITE_HOSEKI_ENV']).unwrapOr('')

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

  const menu = <BaseMenu items={menuItems} renderLink={(to, children) => <Link to={to}>{children}</Link>} />

  const header = <Header logo={logo} menu={menu} userInfo={<UserInfo />} />

  return (
    <BaseAppLayout header={header} fullWidth={fullWidth}>
      <Outlet />
    </BaseAppLayout>
  )
}
