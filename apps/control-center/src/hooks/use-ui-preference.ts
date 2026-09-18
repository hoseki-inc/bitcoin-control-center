import { useEffect, useRef, useState } from 'react'
import { isDesktop } from '../mode'
import { useLocalSetting } from './use-local-settings'

type Preference = 'sidebar_compact' | 'statements_banner_dismissed'

function readBrowserPreference(key: Preference): boolean {
  try {
    return key === 'sidebar_compact'
      ? localStorage.getItem('hoseki:sidebar-compact') === 'true'
      : JSON.parse(localStorage.getItem('ui::settings::local') ?? '{}').isStatementsMadeEasyDismissed === true
  } catch {
    return false
  }
}

/** Desktop preferences live with Sentinel data, independently of its HTTP port. */
export function useUiPreference(key: Preference): [boolean, (value: boolean) => void] {
  const { data, save, isSaving } = useLocalSetting(key, isDesktop)
  const [browserValue, setBrowserValue] = useState(() => readBrowserPreference(key))
  const migrated = useRef(false)
  useEffect(() => {
    if (!isDesktop || data !== null || !browserValue || migrated.current) return
    migrated.current = true
    save('true')
  }, [data, browserValue, save])
  return [
    isDesktop && data != null ? data === 'true' : browserValue,
    (value) => {
      if (isDesktop) {
        if (!isSaving) {
          // A delayed initial read must not migrate an older value over this choice.
          migrated.current = true
          save(String(value))
        }
        return
      }
      // Node deployments keep preferences specific to this browser.
      try {
        if (key === 'sidebar_compact') localStorage.setItem('hoseki:sidebar-compact', String(value))
        else localStorage.setItem('ui::settings::local', JSON.stringify({ isStatementsMadeEasyDismissed: value }))
      } catch {}
      setBrowserValue(value)
    },
  ]
}
