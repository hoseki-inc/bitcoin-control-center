// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// Over Tor the bundle can take a while to arrive; index.html shows the page's outline until it does.
const html = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8')
const page = new DOMParser().parseFromString(html, 'text/html')

it('shows a busy placeholder inside the root until the app renders over it', () => {
  const placeholder = page.querySelector('#root > [aria-busy="true"]')
  expect(placeholder?.textContent.trim()).toBe('Loading Bitcoin Control Center')
  expect(placeholder?.querySelector('.boot-page')?.getAttribute('aria-hidden')).toBe('true')
  expect(page.querySelector('noscript')?.textContent).toContain('needs JavaScript')
})

it('waits before showing the placeholder and keeps it still for reduced motion', () => {
  const styles = page.querySelector('style')?.textContent ?? ''
  expect(styles).toMatch(/\.boot-page \{[^}]*opacity: 0;[^}]*animation: boot-in [^;]* 300ms forwards;/)
  expect(styles).toMatch(
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.boot-page \{\s*opacity: 1;\s*animation: none;/,
  )
})
