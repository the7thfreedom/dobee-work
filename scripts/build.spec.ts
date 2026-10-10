import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('repository build CLI', () => {
  it('uses the fast library build regardless of client metadata profile', () => {
    const build = readFileSync(resolve(root, 'scripts/build.ts'), 'utf8')
    expect(build).toContain("runScript(values.scope === 'desktop' ? 'build:lib:desktop' : 'build:lib:fast', buildEnvironment)")
    expect(build).not.toContain("runScript('build:lib',")
  })

  it('checks Desktop Host declarations before generating Typert without duplicate project diagnostics', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['build:lib:desktop']).toBe('tsx scripts/dobee-desktop-build.ts')
    const coordinator = readFileSync(resolve(root, 'scripts/dobee-desktop-build.ts'), 'utf8')
    expect(coordinator).toContain("build('host', true)")
    expect(coordinator.indexOf("declarations('host', false)")).toBeLessThan(coordinator.indexOf("build('host', true)"))
    expect(coordinator.indexOf("build('host', true)")).toBeLessThan(coordinator.indexOf("declarations('client', true)"))
    expect(manifest.scripts['build:lib:host:desktop'])
      .toBe('tsx scripts/dobee-declarations.ts --face host && tsx scripts/dobee-vite-build.ts --face host --checked && tsx scripts/dobee-vite-build.ts --face desktop')
    expect(manifest.scripts['build:lib:host:desktop']).not.toContain('--fast')
  })

  it('covers both Desktop compiler faces without a second Desktop development build', () => {
    for (const face of ['host', 'client']) {
      expect(readFileSync(resolve(root, `tsconfig.${face}.json`), 'utf8'))
        .toContain(`./apps/desktop/tsconfig.${face}.json`)
    }
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['build:lib:host']).toContain('scripts/dobee-vite-build.ts --face desktop')
    const launcher = readFileSync(resolve(root, 'apps/desktop/scripts/dev.ts'), 'utf8')
    expect(launcher.match(/await runPackageScript\('build[^']*', [A-Z_]+/gu))
      .toEqual(["await runPackageScript('build:desktop-runtime', REPOSITORY_ROOT"])
    expect(launcher).toContain("values.watch ? ['--record-ui-baseline'] : []")
  })

  // The sentinel makes parseArgs fail fast if the check ever stops running first.
  it('rejects a Node process without TypeScript type stripping before any build step', () => {
    const result = spawnSync(
      process.execPath,
      ['--no-experimental-strip-types', '--import', 'tsx/esm', resolve(root, 'scripts/build.ts'), '--spec-sentinel'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('build: Node.js TypeScript type stripping is unavailable')
  })
})
