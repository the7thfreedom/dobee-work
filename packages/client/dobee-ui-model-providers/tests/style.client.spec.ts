import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/Section.module.css', import.meta.url), 'utf8')

it('keeps both panes within narrow settings content and uses the modal’s existing frame clearance', () => {
  expect(css).toContain('grid-template-columns: minmax(140px, 180px) minmax(0, 1fr)')
  expect(css).toContain('grid-template-columns: 140px minmax(0, 1fr)')
  expect(css).not.toContain('--dsh-frame-top-clearance:')
  expect(css).not.toMatch(/font-weight:\s*[6-9]\d\d/)
  expect(css).not.toMatch(/(?:color|background):\s*(?:#|rgb|hsl)/)
})

it('keeps list scrollbars inset and respects reduced motion', () => {
  expect(css).toMatch(/\.providerList\s*\{[^}]*overflow: auto;[^}]*padding: 2px;/)
  expect(css).toMatch(/\.models\s*\{[^}]*overflow: auto;[^}]*padding: 2px;/)
  expect(css).toContain('@media (prefers-reduced-motion: reduce)')
})
