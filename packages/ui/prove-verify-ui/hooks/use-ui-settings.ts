import { useState } from 'react'
import type { Primitive } from 'type-fest'

export function useUiSettings<T extends Record<string, Primitive>>(args: {
  userId?: string
  defaultSettings: T
}): T & { updateUiSettings: (settings: Partial<T>) => void } {
  const localStorageKey = `ui::settings::${args.userId}`

  function getLocalStorage() {
    let currentValue
    try {
      const value = localStorage.getItem(localStorageKey)
      currentValue = value ? JSON.parse(value) : args.defaultSettings
    } catch (error) {
      console.error('Error retrieving UI settings from localStorage', error)
      return args.defaultSettings
    }

    return currentValue
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
