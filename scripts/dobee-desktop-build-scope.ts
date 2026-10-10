/** Select Desktop runtime packages and their configuration-loaded plugins without merging plugin outputs. */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { loadCordisYaml } from './cordis-yaml.ts'

/** Runtime roots retain Desktop's bundled CLI profiles as well as its application and Renderer. */
export const DOBEE_DESKTOP_BUILD_ROOTS = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-desktop',
  '@deepseek-ai/dsh-desktop-host',
  '@deepseek-ai/dsh-web-frontend',
] as const

/** Workspace package data needed for runtime and configuration dependency selection. */
export interface DobeeScopePackage {
  readonly name: string
  readonly directory: string
  readonly dependencies: readonly string[]
  readonly sourceDependencies: readonly string[]
  readonly configurationDependencies: readonly string[]
}

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : specifier.split('/')[0] ?? specifier
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sourceDependencies(directory: string): string[] {
  const names = new Set<string>()
  for (const path of globSync('src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}', { cwd: directory })) {
    const file = ts.createSourceFile(path, readFileSync(join(directory, path), 'utf8'), ts.ScriptTarget.Latest, false,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : undefined)
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
        && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause
        if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)
          && clause.name === undefined && clause.namedBindings.elements.every(element => element.isTypeOnly)) return
        names.add(packageName(node.moduleSpecifier.text))
      } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined
        && ts.isStringLiteral(node.moduleSpecifier)) {
        names.add(packageName(node.moduleSpecifier.text))
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        const argument = node.arguments[0]
        if (argument !== undefined && ts.isStringLiteral(argument)) names.add(packageName(argument.text))
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return [...names].sort()
}

function configurationDependencies(directory: string, value: Record<string, unknown>): string[] {
  const names = new Set<string>()
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child)
    } else if (record(entry)) {
      if (typeof entry.name === 'string' && entry.name.startsWith('@deepseek-ai/')) names.add(packageName(entry.name))
      for (const child of Object.values(entry)) visit(child)
    }
  }
  const dsh = value.dsh
  if (record(dsh)) {
    if (record(dsh.client) && Array.isArray(dsh.client.external)) {
      for (const name of dsh.client.external) {
        if (typeof name !== 'string') throw new Error(`dobee-build-scope: ${directory} has a non-string client external`)
        names.add(packageName(name))
      }
    }
    if (record(dsh.profile) && Array.isArray(dsh.profile.bundles)) {
      for (const name of dsh.profile.bundles) {
        if (typeof name !== 'string') throw new Error(`dobee-build-scope: ${directory} has a non-string profile bundle`)
        names.add(name)
      }
    }
    if (record(dsh.bundle)) {
      const patches = Array.isArray(dsh.bundle.patch) ? dsh.bundle.patch : [dsh.bundle.patch]
      for (const patch of patches) {
        if (typeof patch !== 'string') throw new Error(`dobee-build-scope: ${directory} has an invalid bundle patch`)
        const path = resolve(directory, patch)
        if (!existsSync(path)) throw new Error(`dobee-build-scope: missing bundle patch ${path}`)
        visit(loadCordisYaml(readFileSync(path, 'utf8')))
      }
    }
  }
  return [...names].sort()
}

/**
 * Read package identities and all declared or source-visible runtime edges.
 * @param root - Repository root containing workspace packages.
 * @returns Packages keyed by npm identity, including plugin-config edges.
 */
export function dobeeWorkspaceBuildPackages(root: string): ReadonlyMap<string, DobeeScopePackage> {
  const packages = new Map<string, DobeeScopePackage>()
  for (const path of globSync([
    'packages/*/*/package.json', 'vendor/*/package.json', 'apps/*/package.json', 'native/system/packages/*/package.json',
  ], { cwd: root }).sort()) {
    const directory = resolve(root, dirname(path))
    const value: unknown = JSON.parse(readFileSync(join(root, path), 'utf8'))
    if (!record(value) || typeof value.name !== 'string') throw new Error(`dobee-build-scope: invalid manifest ${path}`)
    if (packages.has(value.name)) throw new Error(`dobee-build-scope: duplicate package ${value.name}`)
    const dependencies = new Set<string>()
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const configured = value[section]
      if (configured === undefined) continue
      if (!record(configured)) throw new Error(`dobee-build-scope: invalid ${section} in ${path}`)
      for (const [name, specifier] of Object.entries(configured)) {
        if (typeof specifier !== 'string') throw new Error(`dobee-build-scope: invalid dependency ${name} in ${path}`)
        if (specifier.startsWith('workspace:')) dependencies.add(name)
      }
    }
    packages.set(value.name, {
      name: value.name, directory, dependencies: [...dependencies].sort(),
      sourceDependencies: sourceDependencies(directory),
      configurationDependencies: configurationDependencies(directory, value),
    })
  }
  return packages
}

/**
 * Follow runtime dependency edges while retaining cycles and conditional configured plugins.
 * @param packages - Available workspace packages.
 * @param roots - Application package identities.
 * @returns Selected package identities in deterministic order.
 */
export function dobeeDesktopPackageClosure(
  packages: ReadonlyMap<string, DobeeScopePackage>,
  roots: readonly string[] = DOBEE_DESKTOP_BUILD_ROOTS,
): ReadonlySet<string> {
  const selected = new Set<string>()
  const visit = (name: string): void => {
    if (selected.has(name)) return
    const item = packages.get(name)
    if (item === undefined) throw new Error(`dobee-build-scope: missing required workspace package ${name}`)
    selected.add(name)
    for (const dependency of [...item.dependencies, ...item.configurationDependencies]) {
      if (packages.has(dependency) || dependency.startsWith('@deepseek-ai/dsh-')
        || item.dependencies.includes(dependency)) visit(dependency)
    }
    for (const dependency of item.sourceDependencies) {
      if (packages.has(dependency)) visit(dependency)
    }
  }
  for (const root of roots) visit(root)
  return new Set([...selected].sort())
}
