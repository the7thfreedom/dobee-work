/** Emit Desktop dependency declarations without checking unrelated aggregate tests and scripts. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import ts from 'typescript'
import { dobeeDesktopPackageClosure, dobeeWorkspaceBuildPackages } from './dobee-desktop-build-scope.ts'

const root = resolve(import.meta.dirname, '..')

/**
 * Select emitting leaf projects registered for one compiler face.
 * @param repository - Repository root.
 * @param face - Independent Host or Client compiler face.
 * @param directories - Selected runtime package directories.
 * @returns Absolute registered project paths; project references preserve declaration dependencies.
 */
export function dobeeDeclarationProjects(
  repository: string,
  face: 'host' | 'client',
  directories: ReadonlySet<string>,
): string[] {
  const path = join(repository, `tsconfig.${face}.json`)
  const loaded = ts.readConfigFile(path, file => ts.sys.readFile(file))
  if (loaded.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
  const value: unknown = loaded.config
  if (typeof value !== 'object' || value === null || !('references' in value) || !Array.isArray(value.references)) {
    throw new Error(`dobee-declarations: ${path} needs explicit project references`)
  }
  const selected: string[] = []
  const references: readonly unknown[] = value.references
  for (const reference of references) {
    if (typeof reference !== 'object' || reference === null || !('path' in reference) || typeof reference.path !== 'string') {
      throw new Error(`dobee-declarations: invalid project reference in ${path}`)
    }
    const target = resolve(repository, reference.path)
    const directory = target.endsWith('.json') ? dirname(target) : target
    if (directories.has(directory)) selected.push(target)
  }
  if (selected.length === 0) throw new Error(`dobee-declarations: no ${face} projects selected`)
  return selected.sort()
}

/**
 * Emit project declarations with optional deferred semantic checking.
 * @param repository - Repository supplying the installed TypeScript compiler.
 * @param config - Emitting project or solution configuration.
 * @param fast - Whether semantic checks are deferred; false checks pending fast-emitted projects.
 * @returns Nothing; throws for a missing compiler, spawn failure, or nonzero compiler exit.
 */
export function dobeeEmitDeclarations(repository: string, config: string, fast: boolean): void {
  const compiler = join(repository, 'node_modules/typescript/bin/tsc')
  if (!existsSync(compiler)) throw new Error('dobee-declarations: missing TypeScript; run pnpm install')
  const result = spawnSync(process.execPath, [
    '--max-old-space-size=4096', compiler, '-b', config, '--emitDeclarationOnly', ...(fast ? ['--noCheck'] : []),
  ], { cwd: repository, env: process.env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`dobee-declarations: ${config} exited with ${String(result.status ?? result.signal)}`)
}

function main(): void {
  const { values } = parseArgs({
    options: { face: { type: 'string' }, fast: { type: 'boolean', default: false } },
  })
  const face = values.face
  if (face !== 'host' && face !== 'client') throw new Error('dobee-declarations: --face must be host or client')
  const scope = process.env.DSH_BUILD_SCOPE ?? 'all'
  if (scope !== 'all' && scope !== 'desktop') throw new Error('dobee-declarations: DSH_BUILD_SCOPE must be all or desktop')
  const started = performance.now()
  let config = join(root, `tsconfig.${face}.json`)
  if (scope === 'desktop') {
    const packages = dobeeWorkspaceBuildPackages(root)
    const names = dobeeDesktopPackageClosure(packages)
    const directories = new Set([...names].map((name) => {
      const item = packages.get(name)
      if (item === undefined) throw new Error(`dobee-declarations: missing selected package ${name}`)
      return item.directory
    }))
    const projects = dobeeDeclarationProjects(root, face, directories)
    config = join(root, '.dsh-build', `dobee-desktop-${face}.json`)
    mkdirSync(dirname(config), { recursive: true })
    writeFileSync(config, `${JSON.stringify({ files: [], references: projects.map(path => ({ path })) }, null, 2)}\n`)
    console.log(`dobee-build: ${face} declarations select ${String(projects.length)} direct projects (${String(names.size)} runtime packages)`)
  }
  dobeeEmitDeclarations(root, config, values.fast)
  console.log(`dobee-build: ${face} declarations completed in ${((performance.now() - started) / 1000).toFixed(3)}s`)
}

if (import.meta.main) main()
