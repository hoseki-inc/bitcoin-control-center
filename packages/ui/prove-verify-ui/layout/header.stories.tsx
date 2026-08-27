import type { Story, StoryDefault } from '@ladle/react'
import { Logo } from '../logo'
import { Header as BaseHeader, Menu as BaseMenu } from './header'

export default {
  title: 'Prove and Verify / Header',
} satisfies StoryDefault

export const Empty: Story = () => {
  return <BaseHeader logo={<p>Logo</p>} menu={<p>Menu Items Go Here</p>} userInfo={<p>UserInfo</p>} />
}

export const Full: Story = () => {
  return (
    <BaseHeader
      logo={<Logo renderLink={(children) => <a href="/">{children}</a>} />}
      menu={
        <BaseMenu
          items={[
            { to: '/foo', title: 'Home' },
            { to: '/bar', title: 'Second Item' },
            { to: '/baz', title: 'Third Item' },
          ]}
          renderLink={(to, children) => <a href={to}>{children}</a>}
        />
      }
      userInfo={<p>User Info</p>}
    />
  )
}
