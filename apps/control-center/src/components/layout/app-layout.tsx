import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import {
  AppLayout as BaseAppLayout,
  Logo as BaseLogo,
  Menu as BaseMenu,
  Header,
  getEnvSlug,
} from '@hoseki/packages/ui/prove-verify-ui'
import { Link, NavLink, Outlet } from 'react-router'
import { z } from 'zod'
import { isDesktop } from '../../mode'
import { ReleaseNotice } from './release-notice'
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
    <BaseLogo renderLink={(children) => <Link to={logoLink}>{children}</Link>} stickerLabel={getEnvSlug(HOSEKI_ENV)} />
  )

  const menu = <BaseMenu items={menuItems} renderLink={(to, children) => <NavLink to={to}>{children}</NavLink>} />

  const header = <Header logo={logo} menu={menu} userInfo={<UserInfo />} />

  return (
    <BaseAppLayout header={header} fullWidth={fullWidth}>
      <Outlet />
      {isDesktop && <ReleaseNotice />}
    </BaseAppLayout>
  )
}
