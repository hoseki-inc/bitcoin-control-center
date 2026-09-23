import type { SystemStyleObject } from '@chakra-ui/react'

/**
 * Glass materials. One recipe is parameterised by CSS variables so each surface
 * (menu, toast, modal, window) only overrides what differs, and so accessibility
 * fallbacks can swap the whole material in one place.
 *
 * Dark values follow the measured umbrelOS 2.0 material; the light glass values
 * are our own.
 */
const darkMaterial = {
  '--material-tint': 'rgb(0 0 0 / 0.4)',
  '--material-filter': 'blur(20px) saturate(120%) brightness(85%)',
  '--material-edge': 'rgb(255 255 255 / 0.1)',
  '--material-shine': '0.2',
  '--material-shadow': '0 14px 34px rgb(0 0 0 / 0.5)',
  '--toast-tint': 'rgb(0 0 0 / 0.3)',
  '--toast-filter': 'blur(10px) saturate(120%) brightness(95%)',
  '--toast-shadow': '0 6px 16px rgb(0 0 0 / 0.3)',
  '--window-tint': 'rgb(0 0 0 / 0.7)',
  '--window-wallpaper-filter': 'blur(40px) saturate(150%) brightness(70%)',
  '--window-edge': 'rgb(255 255 255 / 0.08)',
  '--window-shine': '0.25',
  '--window-shadow': '0 10px 64px rgb(0 0 0 / 0.8)',
  '--glass-cell-bg': 'linear-gradient(to bottom, rgb(255 255 255 / 0.03), rgb(255 255 255 / 0.09))',
  '--glass-cell-shadow': 'inset 0 2px 3px -1px rgb(0 0 0 / 0.22), inset 0 -1px 0 rgb(255 255 255 / 0.09)',
  '--glass-track-bg': 'rgb(255 255 255 / 0.1)',
  '--glass-track-shadow': 'inset 0 1px 1.5px rgb(0 0 0 / 0.22), inset 0 -0.5px 0 rgb(255 255 255 / 0.07)',
  '--focus-band': 'rgb(0 0 0 / 0.4)',
}

const lightMaterial: typeof darkMaterial = {
  '--material-tint': 'rgb(255 255 255 / 0.55)',
  '--material-filter': 'blur(20px) saturate(160%) brightness(105%)',
  '--material-edge': 'rgb(15 23 42 / 0.08)',
  '--material-shine': '0.7',
  '--material-shadow': '0 14px 34px rgb(15 23 42 / 0.14)',
  '--toast-tint': 'rgb(255 255 255 / 0.7)',
  '--toast-filter': 'blur(10px) saturate(160%) brightness(105%)',
  '--toast-shadow': '0 6px 16px rgb(15 23 42 / 0.12)',
  '--window-tint': 'rgb(255 255 255 / 0.62)',
  '--window-wallpaper-filter': 'blur(40px) saturate(160%) brightness(112%)',
  '--window-edge': 'rgb(15 23 42 / 0.08)',
  '--window-shine': '0.8',
  '--window-shadow': '0 10px 64px rgb(15 23 42 / 0.25)',
  '--glass-cell-bg': 'linear-gradient(to bottom, rgb(255 255 255 / 0.35), rgb(255 255 255 / 0.6))',
  '--glass-cell-shadow': 'inset 0 2px 3px -1px rgb(15 23 42 / 0.1), inset 0 -1px 0 rgb(255 255 255 / 0.8)',
  '--glass-track-bg': 'rgb(15 23 42 / 0.08)',
  '--glass-track-shadow': 'inset 0 1px 1.5px rgb(15 23 42 / 0.12), inset 0 -0.5px 0 rgb(255 255 255 / 0.7)',
  '--focus-band': 'rgb(255 255 255 / 0.6)',
}

const shared = {
  '--radius-menu': '20px',
  '--radius-menu-item': '16px',
  '--radius-toast': '18px',
  '--radius-modal': '24px',
  '--radius-window': '24px',
}

export const materialGlobalStyles: Record<string, SystemStyleObject> = {
  ':root': { ...shared, ...lightMaterial },
  ':root[data-theme="dark"]': darkMaterial,
  '@media (min-width: 1024px)': { ':root': { '--radius-window': '40px' } },
  // Umbrel-style fallbacks: opaque materials when transparency is unwanted or unsupported.
  '@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)': {
    ':root': { '--material-filter': 'none', '--toast-filter': 'none', '--material-tint': 'rgb(255 255 255 / 0.96)' },
    ':root[data-theme="dark"]': { '--material-tint': 'rgb(14 15 19 / 0.94)' },
  },
  '@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))': {
    ':root': { '--material-tint': 'rgb(255 255 255 / 0.9)' },
    ':root[data-theme="dark"]': { '--material-tint': 'rgb(14 15 19 / 0.82)' },
  },
}

/** Four-part inner highlight plus a drop shadow, driven by a shine opacity variable. */
const shine = (shineVar: string, shadowVar: string): string =>
  [
    `inset 1px 0 rgb(255 255 255 / calc(var(${shineVar}) * 0.3))`,
    `inset -1px 0 rgb(255 255 255 / calc(var(${shineVar}) * 0.3))`,
    `inset 0 1px rgb(255 255 255 / var(${shineVar}))`,
    `inset 0 0.5px rgb(255 255 255 / calc(var(${shineVar}) * 0.5))`,
    `var(${shadowVar})`,
  ].join(', ')

const material: SystemStyleObject = {
  bg: 'var(--material-tint)',
  backdropFilter: 'var(--material-filter)',
  border: '0.5px solid var(--material-edge)',
  backgroundClip: 'padding-box',
  boxShadow: shine('--material-shine', '--material-shadow'),
  color: 'text.primary',
}

export const layerStyles = {
  material,
  'material.menu': { ...material, borderRadius: 'var(--radius-menu)' },
  'material.modal': { ...material, borderRadius: 'var(--radius-modal)' },
  'material.toast': {
    ...material,
    bg: 'var(--toast-tint)',
    backdropFilter: 'var(--toast-filter)',
    boxShadow: shine('--material-shine', '--toast-shadow'),
    borderRadius: 'var(--radius-toast)',
  },
  // Large surfaces never blur live content; they paint a cached wallpaper copy underneath.
  window: {
    bg: 'var(--window-tint)',
    borderTopRadius: 'var(--radius-window)',
    boxShadow: 'var(--window-shadow)',
  },
  'window.chrome': {
    border: '0.5px solid var(--window-edge)',
    borderTopRadius: 'var(--radius-window)',
    boxShadow: shine('--window-shine', '--window-shadow'),
    pointerEvents: 'none',
  },
  glassCell: { bgImage: 'var(--glass-cell-bg)', boxShadow: 'var(--glass-cell-shadow)' },
  glassTrack: { bg: 'var(--glass-track-bg)', boxShadow: 'var(--glass-track-shadow)' },
} satisfies Record<string, SystemStyleObject>
