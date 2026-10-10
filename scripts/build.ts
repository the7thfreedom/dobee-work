/** Run the complete repository build and bind its client artifacts to their public environment. */

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import {
  CLIENT_BUILD_RECORD_PATH,
  CLIENT_BUILD_PROFILE_SELECTOR,
  clientBuildProcessEnvironment,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'
import { DOBEE_BUILD_RESULT, dobeeRecordUiBaseline, dobeePlanUiBuild, dobeeRefreshStaticUiBaseline } from './dobee-ui-build.ts'

/** Run one package script through the package manager that invoked this build. */
function runScript(script: string, environment: NodeJS.ProcessEnv): void {
  const started = performance.now()
  const invocation = pnpmInvocation(['run', script], environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${script} exited with ${String(result.status ?? result.signal)}`)
  }
  console.log(`dobee-build: ${script} completed in ${((performance.now() - started) / 1000).toFixed(3)}s`)
}

/** Run the full build selected by `--profile` or `DSH_BUILD_CLIENT_PROFILE`. */
function main(): void {
  // Package declarations use Node type stripping even when the orchestration runs through tsx.
  if (!process.features.typescript) {
    throw new Error('build: Node.js TypeScript type stripping is unavailable in this Node.js process; remove --no-experimental-strip-types from NODE_OPTIONS or use a Node.js build with TypeScript support')
  }
  const { values } = parseArgs({
    options: {
      profile: { type: 'string' }, scope: { type: 'string', default: 'all' },
      ui: { type: 'boolean', default: false },
      'record-ui-baseline': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  const root = resolve(import.meta.dirname, '..')
  if (values.scope !== 'all' && values.scope !== 'desktop') throw new Error('build: --scope must be all or desktop')
  if (values.ui && values.scope !== 'desktop') throw new Error('build: --ui requires --scope desktop')
  if (values['record-ui-baseline'] && values.scope !== 'desktop') throw new Error('build: --record-ui-baseline requires --scope desktop')
  const repositoryEnvironment = repositoryClientBuildEnvironment(root, process.env)
  const profile = values.profile ?? process.env[CLIENT_BUILD_PROFILE_SELECTOR]
  const clientEnvironment = resolveClientBuildEnvironment(repositoryEnvironment, profile)
  const buildEnvironment = {
    ...clientBuildProcessEnvironment(process.env, clientEnvironment),
    DSH_BUILD_SCOPE: values.scope,
  }

  const decision = values.ui ? dobeePlanUiBuild(root, buildEnvironment) : undefined
  const uiOnly = decision?.kind === 'ui'
  const rendererReload = decision?.kind !== 'ui' || decision.rendererReload
  if (decision?.kind === 'full') console.log(`dobee-build: UI fast path rejected: ${decision.reason}; running complete Desktop build`)
  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  rmSync(resolve(root, DOBEE_BUILD_RESULT), { force: true })
  if (uiOnly) {
    runScript(rendererReload ? 'build:lib:ui' : 'build:lib:ui:plugins', buildEnvironment)
  } else {
    runScript('build:native-system', buildEnvironment)
    runScript(values.scope === 'desktop' ? 'build:lib:desktop' : 'build:lib:fast', buildEnvironment)
  }
  if (rendererReload) runScript(values.scope === 'desktop' ? 'build:renderer:desktop' : 'build:web', buildEnvironment)
  if (values.scope === 'desktop' && !uiOnly && (values.ui || values['record-ui-baseline'])) {
    const started = performance.now()
    dobeeRecordUiBaseline(root, buildEnvironment)
    console.log(`dobee-build: recorded Host dependency baseline in ${((performance.now() - started) / 1000).toFixed(3)}s`)
  }
  if (decision?.kind === 'ui' && rendererReload) dobeeRefreshStaticUiBaseline(root, decision.staticUi)
  const record = writeClientBuildRecord(root, clientEnvironment)
  mkdirSync(resolve(root, '.dsh-build'), { recursive: true })
  writeFileSync(resolve(root, DOBEE_BUILD_RESULT), `${JSON.stringify({ nodeChanged: !uiOnly, rendererReload })}\n`)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
}

if (import.meta.main) main()
