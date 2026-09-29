import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { isDesktop } from '../mode'
import { useLocalSetting } from './use-local-settings'

type Preference = 'sidebar_compact' | 'statements_banner_dismissed'

const LegacyUiSettingsSchema = z.object({ isStatementsMadeEasyDismissed: z.boolean() })

function readBrowserPreference(key: Preference): boolean {
  try {
    if (key === 'sidebar_compact') {
      return localStorage.getItem('hoseki:sidebar-compact') === 'true'
    }
    // SAFETY: JSON.parse output is untrusted and validated by the schema below.
    const stored: unknown = JSON.parse(localStorage.getItem('ui::settings::local') ?? '{}')
    return parseUnknown(LegacyUiSettingsSchema, stored)
      .map((settings) => settings.isStatementsMadeEasyDismissed)
      .unwrapOr(false)
  } catch {
    return false
  }
}

/** Desktop preferences live with Sentinel data, independently of its HTTP port. */
export function useUiPreference(key: Preference, desktop = isDesktop): [boolean, (value: boolean) => void] {
  const { data, save, isSaving } = useLocalSetting(key, desktop)
  const [browserValue, setBrowserValue] = useState(() => readBrowserPreference(key))
  const migrated = useRef(false)
  useEffect(() => {
    if (!desktop || data !== null || !browserValue || migrated.current) {
      return
    }
    migrated.current = true
    save('true')
  }, [desktop, data, browserValue, save])
  return [
    desktop && data != null ? data === 'true' : browserValue,
    (value) => {
      if (desktop) {
        if (!isSaving) {
          // A delayed initial read must not migrate an older value over this choice.
          migrated.current = true
          save(String(value))
        }
        return
      }
      // Node deployments keep preferences specific to this browser.
      try {
        if (key === 'sidebar_compact') {
          localStorage.setItem('hoseki:sidebar-compact', String(value))
        } else {
          localStorage.setItem('ui::settings::local', JSON.stringify({ isStatementsMadeEasyDismissed: value }))
        }
      } catch {}
      setBrowserValue(value)
    },
  ]
}
