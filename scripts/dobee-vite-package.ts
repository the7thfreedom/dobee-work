/** Build independent package artifacts with Vite while retaining their declared module and asset policies. */

import { existsSync, globSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { build, type InlineConfig as ViteConfig, type LibraryFormats, type Plugin } from 'vite'
import type { UserConfig } from 'tsdown'
import ts from 'typescript'
import { browserSourceAliases } from './browser-bundled-externals.ts'
import { typertPlugin } from '../packages/typert/generator/src/tsdown-plugin.ts'
import type { DobeeViteBuildFiles } from './dobee-vite-cache.ts'

/** A persistent Vite compiler; completion callbacks run after its files have been written. */
export interface DobeeViteWatch {
  readonly interval: number
  started(): void
  completed(): void
  failed(error: unknown): void
  opened(close: () => Promise<void>): void
}

/** Package metadata needed to preserve production dependency identities and public JavaScript paths. */
export interface DobeeBuildManifest {
  readonly name: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly exports?: unknown
}

/** Legacy package declarations may additionally disable splitting of private entry bundles. */
export type DobeeBuildDeclaration = UserConfig & { readonly codeSplitting?: boolean }

const aliasesByRoot = new Map<string, ReturnType<typeof browserSourceAliases>>()
const decorators = typertPlugin()

/**
 * Resolve an emitted entry to the source file that owns it.
 * @param directory - Package directory.
 * @param entry - Package-relative source or legacy emitted JavaScript entry.
 * @returns Absolute source path; missing entries fail before Vite starts.
 */
export function dobeeSourceEntry(directory: string, entry: string): string {
  entry = entry.replace(/^\.\//, '')
  const path = resolve(directory, entry)
  if (!entry.replaceAll('\\', '/').startsWith('lib/types/')) {
    if (!existsSync(path)) throw new Error(`dobee-vite: missing entry ${path}`)
    return path
  }
  const source = resolve(directory, entry.replaceAll('\\', '/').replace(/^lib\/types\//, 'src/').replace(/\.js$/, ''))
  for (const extension of ['.ts', '.tsx', '.mts', '.cts', '.js']) {
    if (existsSync(`${source}${extension}`)) return `${source}${extension}`
  }
  throw new Error(`dobee-vite: no source owns ${path}`)
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  const slash = specifier.indexOf('/')
  return slash < 0 ? specifier : specifier.slice(0, slash)
}

function matches(
  pattern: NonNullable<UserConfig['deps']>['neverBundle'] | UserConfig['noExternal'],
  id: string,
  importer: string | undefined,
): boolean {
  if (typeof pattern === 'function') return pattern(id, importer, false) === true
  if (typeof pattern === 'boolean') return pattern
  const values = Array.isArray(pattern) ? pattern : pattern === undefined ? [] : [pattern]
  return values.some(value => typeof value === 'string'
    ? id === value || id.startsWith(`${value}/`) : value.test(id))
}

/**
 * Decide whether an import must retain the installed package's runtime identity.
 * @param config - Package-local build declaration.
 * @param manifest - Production dependency sections.
 * @param id - Import specifier.
 * @param importer - Source module containing the import.
 * @returns True when the import must stay external.
 */
export function dobeeExternalImport(
  config: UserConfig,
  manifest: DobeeBuildManifest,
  id: string,
  importer?: string,
): boolean {
  if (config.platform === 'node' && isBuiltin(id)) return true
  /* oxlint-disable typescript/no-deprecated -- Upstream package declarations retain these legacy dependency fields. */
  if (matches(config.deps?.neverBundle ?? config.external, id, importer)) return true
  if (matches(config.deps?.alwaysBundle ?? config.noExternal, id, importer)) return false
  /* oxlint-enable typescript/no-deprecated */
  const name = packageName(id)
  return name in (manifest.dependencies ?? {}) || name in (manifest.peerDependencies ?? {})
    || name in (manifest.optionalDependencies ?? {})
}

function sourceResolver(root: string, config: UserConfig, manifest: DobeeBuildManifest): Plugin {
  let aliases = aliasesByRoot.get(root)
  if (aliases === undefined) {
    aliases = browserSourceAliases(root)
    aliasesByRoot.set(root, aliases)
  }
  const sourceAliases = aliases
  return {
    name: 'dobee-vite-source-edges',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (importer === undefined || source.startsWith('.') || source.startsWith('\0') || isAbsolute(source)) return null
      if (dobeeExternalImport(config, manifest, source, importer)) {
        return { id: source, external: true, ...(isBuiltin(source) ? { moduleSideEffects: false } : {}) }
      }
      const alias = sourceAliases.find(candidate => candidate.find.test(source))
      if (alias === undefined) return null
      const target = source.replace(alias.find, alias.replacement)
      const resolved = await this.resolve(target, importer, { skipSelf: true })
      if (resolved === null) throw new Error(`dobee-vite: cannot resolve source ${source} at ${target}`)
      return resolved
    },
  }
}

function sourceDecorators(): Plugin {
  return {
    name: 'dobee-vite-standard-decorators',
    enforce: 'pre',
    transform(code, id) {
      if (/\.[cm]?tsx?$/.test(id) && /\b(?:await\s+)?using\s+[A-Za-z_$]/.test(code)) {
        const result = ts.transpileModule(code, {
          fileName: id,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX, sourceMap: true,
          },
        })
        return {
          code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
          ...(result.sourceMapText === undefined ? {} : { map: result.sourceMapText }),
        }
      }
      const result = decorators.transform(code, id)
      return result === undefined ? null : { code: result.code, ...(result.map === undefined ? {} : { map: result.map }) }
    },
  }
}

function excelWorker(directory: string): Plugin {
  return {
    name: 'dobee-vite-excel-worker',
    enforce: 'pre',
    resolveId(source) { return source === './worker.ts?raw' ? '\0dobee-excel-worker' : null },
    async load(id) {
      if (id !== '\0dobee-excel-worker') return null
      const recordDependency = async (source: string, importer: string): Promise<void> => { await this.resolve(source, importer) }
      const result = await build({
        configFile: false, root: directory, envDir: false, envPrefix: [], logLevel: 'error',
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        plugins: [{
          name: 'dobee-vite-excel-worker-dependencies',
          enforce: 'pre',
          async resolveId(source, importer) {
            if (importer?.startsWith(join(directory, 'src')) && !source.startsWith('.')) await recordDependency(source, importer)
            return null
          },
        }],
        build: {
          write: false, target: 'es2022', minify: true, reportCompressedSize: false,
          lib: { entry: join(directory, 'src/client/excel/worker.ts'), formats: ['iife'], name: 'DobeeExcelParser' },
        },
      })
      const outputs = Array.isArray(result) ? result : [result]
      const chunk = outputs.flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk')
      if (chunk?.type !== 'chunk') throw new Error('dobee-vite: Excel parser emitted no JavaScript chunk')
      for (const path of Object.keys(chunk.modules)) this.addWatchFile(path)
      return `export default ${JSON.stringify(chunk.code)};`
    },
  }
}

async function pluginsFor(config: UserConfig, directory: string): Promise<Plugin[]> {
  const flattened = async (value: UserConfig['plugins']): Promise<Plugin[]> => {
    const plugin = await value
    if (!plugin) return []
    if (Array.isArray(plugin)) return (await Promise.all(plugin.map(flattened))).flat()
    if (!('name' in plugin)) throw new Error('dobee-vite: parallel compiler plugins are not supported')
    if (plugin.name === 'dsh-excel-worker-source') return [excelWorker(directory)]
    // Package declarations use the newer Rolldown plugin API. The shared hooks
    // used here also exist in Vite's API; native MagicString results need encoding.
    if (plugin.name === 'dsh-client-async-chunk-require' && 'renderChunk' in plugin && typeof plugin.renderChunk === 'function') {
      const render = plugin.renderChunk
      return [{
        ...plugin,
        renderChunk(...args) {
          const result = Reflect.apply(render, this, args) as ReturnType<typeof render>
          if (result !== null && typeof result === 'object' && 'generateMap' in result) {
            return { code: result.toString(), map: result.generateMap().toString() }
          }
          return result
        },
      } as Plugin]
    }
    const ported = plugin as Plugin
    ported.enforce = 'pre'
    return [ported]
  }
  return await flattened(config.plugins)
}

function entryMap(directory: string, configured: NonNullable<UserConfig['entry']>): Record<string, string> {
  const entries: Record<string, string> = {}
  const append = (entry: NonNullable<UserConfig['entry']>): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) append(item)
    } else if (typeof entry === 'string') {
      const name = basename(entry, '.js').replace(/\.[cm]?tsx?$/, '')
      if (name in entries) throw new Error(`dobee-vite: duplicate entry ${name} in ${directory}`)
      entries[name] = dobeeSourceEntry(directory, entry)
    } else {
      for (const [name, configured] of Object.entries(entry)) {
        const paths = Array.isArray(configured) ? configured : [configured]
        const path = paths[0]
        if (paths.length !== 1 || path === undefined) throw new Error(`dobee-vite: ${directory} entry ${name} needs one source`)
        if (name in entries) throw new Error(`dobee-vite: duplicate entry ${name} in ${directory}`)
        entries[name] = dobeeSourceEntry(directory, path)
      }
    }
  }
  append(configured)
  return entries
}

function formatsFor(configured: UserConfig['format']): LibraryFormats[] {
  if (typeof configured === 'object' && !Array.isArray(configured)) {
    throw new Error('dobee-vite: per-format override objects need separate package declarations')
  }
  const formats = Array.isArray(configured) ? configured : [configured ?? 'esm']
  return formats.map((format) => {
    if (format === 'esm' || format === 'module') return 'es'
    if (format === 'cjs' || format === 'commonjs') return 'cjs'
    if (format === 'iife' || format === 'umd') return format
    throw new Error('dobee-vite: unsupported module format')
  })
}

/**
 * Build one package declaration through Vite, keeping sibling outputs intact.
 * @param root - Repository root supplying source aliases.
 * @param directory - Package directory.
 * @param manifest - Package identity and production dependencies.
 * @param config - Existing package-local artifact declaration.
 * @param files - Optional input/output inventory for verified incremental reuse.
 * @param watch - Optional persistent compiler owner; excludes post-build copy and nested lifecycle hooks.
 */
export async function dobeeVitePackage(
  root: string,
  directory: string,
  manifest: DobeeBuildManifest,
  config: DobeeBuildDeclaration,
  files?: DobeeViteBuildFiles,
  watch?: DobeeViteWatch,
): Promise<void> {
  if (!config.entry || Array.isArray(config.entry) && config.entry.length === 0) return
  if (typeof config.inputOptions === 'function' || typeof config.outputOptions === 'function') {
    throw new Error(`dobee-vite: ${manifest.name} needs explicit input/output options`)
  }
  const entries = entryMap(directory, config.entry)
  const formats = formatsFor(config.format)
  if (config.minify !== undefined && typeof config.minify !== 'boolean') {
    throw new Error(`dobee-vite: ${manifest.name} needs a boolean minify setting`)
  }
  const upstream = await pluginsFor(config, directory)
  const conditionNames = config.inputOptions?.resolve?.conditionNames
  // oxlint-disable-next-line typescript/no-deprecated -- Upstream worker declarations retain this single-file output flag.
  const { inlineDynamicImports, ...output } = config.outputOptions ?? {}
  const rolldownOptions = {
    ...config.inputOptions,
    output: {
      exports: 'auto',
      ...(config.codeSplitting === false || inlineDynamicImports === true ? { codeSplitting: false } : {}),
      ...output,
      ...(config.banner === undefined ? {} : { banner: config.banner }),
      ...(config.footer === undefined ? {} : { footer: config.footer }),
    },
  } as NonNullable<NonNullable<ViteConfig['build']>['rolldownOptions']>
  const vite: ViteConfig = {
    configFile: false, root: directory, envDir: false, envPrefix: [], logLevel: 'error',
    ...(config.define === undefined ? {} : { define: config.define }),
    resolve: { ...(conditionNames === undefined ? {} : { conditions: conditionNames }) },
    ssr: { noExternal: true },
    plugins: [sourceDecorators(), ...upstream, sourceResolver(root, config, manifest), {
      name: 'dobee-vite-build-inventory',
      moduleParsed(module) {
        if (files === undefined) return
        const prefixes = ['\0dsh-css:', '\0dsh-inline-css:', '\0dsh-global-css:']
        const prefix = prefixes.find(prefix => module.id.startsWith(prefix))
        const input = prefix === undefined ? module.id.split('?', 1)[0] : module.id.slice(prefix.length, -'.mjs'.length)
        if (input !== undefined && isAbsolute(input) && existsSync(input)) files.inputs.add(input)
      },
      writeBundle(options, bundle) {
        if (files === undefined) return
        for (const [name, output] of Object.entries(bundle)) {
          files.outputs.add(resolve(directory, options.dir ?? config.outDir ?? 'lib', name))
          if (output.type === 'asset') {
            for (const input of output.originalFileNames) {
              if (isAbsolute(input) && existsSync(input)) files.inputs.add(input)
            }
          }
        }
      },
    }, {
      name: 'dobee-declared-output-extensions',
      outputOptions(options) {
        if (config.outExtensions === undefined) return null
        const format = options.format === 'esm' || options.format === 'module' ? 'es'
          : options.format === 'commonjs' ? 'cjs' : options.format ?? 'es'
        if (config.outExtensions.length !== 1) throw new Error(`dobee-vite: ${manifest.name} needs a format-only extension callback`)
        const declared = Reflect.apply(config.outExtensions, undefined, [{ format, pkgType: 'module' }]) as
          ReturnType<NonNullable<UserConfig['outExtensions']>>
        if (declared?.js === undefined) return null
        return { ...options, entryFileNames: `[name]${declared.js}`, chunkFileNames: `[name]-[hash]${declared.js}` }
      },
    }],
    build: {
      ...(watch === undefined ? {} : {
        watch: { watcher: { usePolling: true, pollInterval: watch.interval, compareContentsForPolling: true } },
      }),
      ssr: config.platform !== 'browser',
      outDir: resolve(directory, config.outDir ?? 'lib'), emptyOutDir: false,
      target: config.target ?? 'es2024', minify: config.minify ?? false,
      sourcemap: config.sourcemap ?? false, reportCompressedSize: false, modulePreload: false,
      lib: {
        entry: entries, formats,
        fileName: (format, name) => `${name}.${format === 'cjs' ? 'cjs' : 'js'}`,
      },
      rolldownOptions,
    },
  }
  if (watch !== undefined) {
    if (config.copy !== undefined || config.onSuccess !== undefined || config.hooks !== undefined) {
      throw new Error(`dobee-vite: ${manifest.name} requires the ordinary build path for post-build hooks`)
    }
    const result = await build(vite)
    if (!('on' in result) || !('close' in result)) throw new Error('dobee-vite: persistent build did not return a watcher')
    watch.opened(async () => { await result.close() })
    let failed = false
    result.on('event', (event) => {
      if (event.code === 'START') {
        failed = false
        files?.outputs.clear()
        watch.started()
      } else if (event.code === 'END' && !failed) watch.completed()
      else if (event.code === 'ERROR') { failed = true; watch.failed(event.error) }
    })
    return
  }
  await build(vite)
  if (typeof config.copy === 'function') throw new Error(`dobee-vite: ${manifest.name} needs explicit copy declarations`)
  const copies = Array.isArray(config.copy) ? config.copy : config.copy === undefined ? [] : [config.copy]
  for (const item of copies) {
    if (typeof item === 'string') throw new Error(`dobee-vite: ${manifest.name} needs an explicit asset destination`)
    if (typeof item.to !== 'string') throw new Error(`dobee-vite: ${manifest.name} needs a string asset destination`)
    const paths = globSync(item.from, { cwd: directory })
    if (paths.length === 0) throw new Error(`dobee-vite: ${manifest.name} has no assets matching ${String(item.from)}`)
    await mkdir(resolve(directory, item.to), { recursive: true })
    for (const path of paths) {
      const input = resolve(directory, path)
      const output = resolve(directory, item.to, basename(path))
      await copyFile(input, output)
      files?.inputs.add(input)
      files?.outputs.add(output)
    }
  }
  if (typeof config.onSuccess === 'function') {
    if (config.onSuccess.length !== 0) throw new Error(`dobee-vite: ${manifest.name} needs a zero-argument onSuccess hook`)
    await Reflect.apply(config.onSuccess, undefined, [])
  }
  else if (config.onSuccess !== undefined) throw new Error(`dobee-vite: ${manifest.name} needs a function onSuccess hook`)
  if (typeof config.hooks === 'function') throw new Error(`dobee-vite: ${manifest.name} needs explicit lifecycle hooks`)
  const done = config.hooks?.['build:done']
  if (done !== undefined) {
    if (typeof done !== 'function' || done.length !== 0) throw new Error(`dobee-vite: ${manifest.name} needs a zero-argument build:done hook`)
    await Reflect.apply(done, undefined, [])
  }
}

/**
 * Find public JavaScript exports that the declaration emitter cannot produce.
 * @param exports - Package export map.
 * @returns Literal lib/types JavaScript paths, without wildcard exports.
 */
export function dobeePublicTypeEntries(exports: unknown): string[] {
  if (typeof exports === 'string') return /^\.\/lib\/types\/.*\.js$/.test(exports) && !exports.includes('*') ? [exports] : []
  if (Array.isArray(exports)) return exports.flatMap(dobeePublicTypeEntries)
  if (typeof exports !== 'object' || exports === null) return []
  return [...new Set(Object.values(exports).flatMap(dobeePublicTypeEntries))]
}
