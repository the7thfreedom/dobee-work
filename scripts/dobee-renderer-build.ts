/** Cache the Desktop Renderer shell using Vite's physical input inventory and verified emitted files. */

import { existsSync, globSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { InlineConfig, Plugin } from 'vite'
import { DobeeViteArtifactCache, dobeeViteBuildKey } from './dobee-vite-cache.ts'

/**
 * Build or reuse the independent Renderer shell through its package-owned Vite version.
 * @param root - Repository root.
 * @param environment - Environment supplied to Vite; public values remain part of the cache key.
 * @returns Whether existing Renderer files were reused after input/output content verification.
 */
export async function dobeeBuildRenderer(root: string, environment: NodeJS.ProcessEnv): Promise<boolean> {
  const directory = resolve(root, 'apps/web')
  const outputs = (): string[] => globSync('dist/**/*', { cwd: directory })
    .map(path => resolve(directory, path)).filter(path => statSync(path).isFile())
  const cache = new DobeeViteArtifactCache(root, 'renderer', dobeeViteBuildKey(root, environment), outputs)
  return await cache.run(directory, async (files) => {
    const require = createRequire(resolve(directory, 'package.json'))
    // The shell configuration belongs to this package's Vite version, not the workspace's library builder.
    const vite = await import(pathToFileURL(require.resolve('vite')).href) as { build(config: InlineConfig): Promise<unknown> }
    const inventory = (): Plugin => ({
      name: 'dobee-renderer-input-inventory',
      enforce: 'pre',
      load(id) {
        const file = id.split('?', 1)[0]
        if (file !== undefined && existsSync(file) && statSync(file).isFile()) files.inputs.add(resolve(file))
        return null
      },
      moduleParsed(module) {
        const file = module.id.split('?', 1)[0]
        if (file !== undefined && existsSync(file) && statSync(file).isFile()) files.inputs.add(resolve(file))
      },
      writeBundle(_options, bundle) {
        for (const item of Object.values(bundle)) {
          if (item.type !== 'chunk') continue
          for (const module of Object.keys(item.modules)) {
            const file = module.split('?', 1)[0]
            if (file !== undefined && existsSync(file) && statSync(file).isFile()) files.inputs.add(resolve(file))
          }
        }
      },
    })
    for (const path of globSync('packages/client/ui-theme/src/styles/*', { cwd: root })) {
      const absolute = resolve(root, path)
      if (statSync(absolute).isFile()) files.inputs.add(absolute)
    }
    await vite.build({
      root: directory, configFile: resolve(directory, 'vite.config.ts'),
      plugins: [inventory()], worker: { plugins: () => [inventory()] },
    })
    // Preview generation writes in closeBundle, after Vite's writeBundle hook.
    for (const output of outputs()) files.outputs.add(output)
  })
}

if (import.meta.main) {
  const reused = await dobeeBuildRenderer(resolve(import.meta.dirname, '..'), process.env)
  console.log(`dobee-build: Renderer ${reused ? 'reused verified output' : 'built through Vite'}`)
}
