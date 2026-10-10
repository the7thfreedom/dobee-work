/** Coordinate Desktop compiler faces in dependency order while sharing one runtime package selection. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { dobeeDesktopPackageClosure, dobeeWorkspaceBuildPackages } from './dobee-desktop-build-scope.ts'
import { dobeeDeclarationProjects, dobeeEmitDeclarations } from './dobee-declarations.ts'
import type { DobeeViteFace, DobeeViteSelection } from './dobee-vite-build.ts'

/**
 * Select the runtime once and finish Host checking/reflection before compiling Client imports.
 * @param root - Repository root.
 */
export function dobeeBuildDesktop(root: string): void {
  if (process.env.DSH_BUILD_SCOPE !== 'desktop') throw new Error('dobee-desktop-build: invoke through build:desktop-runtime')
  const started = performance.now()
  const packages = dobeeWorkspaceBuildPackages(root)
  const names = dobeeDesktopPackageClosure(packages)
  const directories = new Set([...names].map((name) => {
    const item = packages.get(name)
    if (item === undefined) throw new Error(`dobee-desktop-build: missing selected package ${name}`)
    return item.directory
  }))
  const selection: DobeeViteSelection = { names, directories, totalPackages: packages.size }
  console.log(`dobee-build: shared Desktop selection completed in ${((performance.now() - started) / 1000).toFixed(3)}s`)
  const declarations = (face: 'host' | 'client', fast: boolean): void => {
    const started = performance.now()
    const projects = dobeeDeclarationProjects(root, face, directories)
    const path = resolve(root, '.dsh-build', `dobee-desktop-${face}.json`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ files: [], references: projects.map(path => ({ path })) }, null, 2)}\n`)
    dobeeEmitDeclarations(root, path, fast)
    console.log(`dobee-build: ${face} declarations completed in ${((performance.now() - started) / 1000).toFixed(3)}s`)
  }
  const concurrency = availableParallelism()
  const build = (face: DobeeViteFace, checked: boolean): void => {
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', resolve(root, 'scripts/dobee-vite-build.ts'),
      '--face', face, '--concurrency', String(concurrency), '--selection-stdin', ...(checked ? ['--checked'] : [])], {
      cwd: root, env: process.env, stdio: ['pipe', 'inherit', 'inherit'],
      input: JSON.stringify({ names: [...selection.names], directories: [...selection.directories],
        totalPackages: selection.totalPackages }),
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`dobee-desktop-build: ${face} exited ${String(result.status ?? result.signal)}`)
  }
  declarations('host', false)
  build('host', true)
  build('desktop', true)
  declarations('client', true)
  build('client', false)
}

if (import.meta.main) dobeeBuildDesktop(resolve(import.meta.dirname, '..'))
