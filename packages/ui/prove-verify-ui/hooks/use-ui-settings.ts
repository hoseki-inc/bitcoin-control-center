import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { useState } from 'react'
import type { Primitive } from 'type-fest'
import type { z } from 'zod'

export function useUiSettings<T extends Record<string, Primitive>>(args: {
  userId?: string
  defaultSettings: T
  schema: z.ZodType<T>
}): T & { updateUiSettings: (settings: Partial<T>) => void } {
  const localStorageKey = `ui::settings::${args.userId}`

  function getLocalStorage(): T {
    try {
      const value = localStorage.getItem(localStorageKey)
      return value ? parseUnknown(args.schema, JSON.parse(value)).unwrapOr(args.defaultSettings) : args.defaultSettings
    } catch (error) {
      console.error('Error retrieving UI settings from localStorage', error)
      return args.defaultSettings
    }
  }

  const [uiSettings, setUiSettings] = useState<T>(() => getLocalStorage())

  function updateUiSettings(settings: Partial<T>) {
    if (!args.userId) {
      return
    }

    const updatedSettings = { ...uiSettings, ...settings }
    setUiSettings(updatedSettings)
    localStorage.setItem(localStorageKey, JSON.stringify(updatedSettings))
  }

  return {
    ...uiSettings,
    updateUiSettings,
  }
}
