const HELP_URL = 'https://help.hoseki.app/bitcoin-control-center'

// Only these top-level screens are named; anything else, such as a mistyped address, is "other".
const SCREENS = new Set(['home', 'accounts', 'portfolio', 'statements', 'settings', 'multisig'])

export type HelpPlatform = 'desktop' | 'startos' | 'umbrel' | 'web'

/** The desktop's OS family from what the browser reports, or "other". */
export function osFamily(platform: string): string {
  const name = platform.toLowerCase()
  if (name.startsWith('mac')) {
    return 'mac'
  }
  if (name.startsWith('win')) {
    return 'windows'
  }
  return name.includes('linux') ? 'linux' : 'other'
}

/**
 * The help center link, tagged with where the click came from. Every value comes from a short fixed list
 * shared by many installs, so the tags count clicks without telling people apart.
 */
export function helpLink({
  platform,
  os,
  version,
  pathname,
}: {
  platform: HelpPlatform
  os: string
  version: string
  pathname: string
}): string {
  const screen = pathname.split('/')[1] ?? ''
  const params = new URLSearchParams({
    utm_source: 'bitcoin-control-center',
    utm_medium: 'app',
    utm_campaign: 'help-button',
    utm_content: platform === 'desktop' ? `desktop-${osFamily(os)}` : platform,
  })
  if (version !== '') {
    params.set('utm_term', version)
  }
  params.set('screen', SCREENS.has(screen) ? screen : 'other')
  return `${HELP_URL}?${params.toString()}`
}
