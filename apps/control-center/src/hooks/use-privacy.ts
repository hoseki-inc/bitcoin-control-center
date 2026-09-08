import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'control-center:privacy'
const CHANGE_EVENT = 'control-center:privacy-change'
let hidden = false

function getSnapshot(): boolean {
  try {
    hidden = localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    // Keep the toggle usable when browser storage is unavailable.
  }
  return hidden
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function usePrivacy(): { hidden: boolean; toggle: () => void } {
  const isHidden = useSyncExternalStore(subscribe, getSnapshot, () => false)
  return {
    hidden: isHidden,
    toggle: () => {
      hidden = !getSnapshot()
      try {
        localStorage.setItem(STORAGE_KEY, String(hidden))
      } catch {
        // The in-memory preference still works for this session.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT))
    },
  }
}
