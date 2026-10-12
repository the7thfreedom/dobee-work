/** Resource ownership and model settings in the shipped Desktop composition. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { composeEntries, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { createPluginProfile } from '../src/project-manager.ts'

it('retains shared resources and replaces upstream model settings in the Desktop Web profile', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-mcp-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    createPluginProfile(profileDir)
    const installAnchor = fileURLToPath(new URL('../../cli/package.json', import.meta.url))
    const profile = loadProfileDirectory('dsh desktop', profileDir, installAnchor)
    const warnings: string[] = []
    const rows = composeEntries([
      ...profile.layers.map(layer => layer.patches),
      profile.patches,
    ], message => warnings.push(message))

    expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-resources')).toEqual([
      { id: 'mcp-resources', name: '@deepseek-ai/dsh-mcp-resources' },
    ])
    expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-client')).toEqual([])
    expect(rows.find(row => row.id === 'webserver')).toMatchObject({ name: '@deepseek-ai/dsh-host-webserver' })
    expect(rows.find(row => row.id === 'webserver')?.disabled).not.toBe(true)
    for (const [id, name] of [
      ['ui-settings-models', '@deepseek-ai/dsh-client-ui-settings-models'],
      ['llm-deepseek', '@deepseek-ai/dsh-llm-deepseek-api-key'],
      ['llm-deepseek-account', '@deepseek-ai/dsh-llm-deepseek-account'],
      ['llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai'],
    ]) {
      expect(rows.find(row => row.id === id)).toMatchObject({ name, disabled: true })
    }
    for (const id of ['dobee-model-providers', 'dobee-model-controller', 'dobee-ui-model-providers', 'ui-model-selection']) {
      expect(rows.find(row => row.id === id)).toBeDefined()
      expect(rows.find(row => row.id === id)?.disabled).not.toBe(true)
    }
    expect(rows.find(row => row.id === 'agent-default-model')?.config).toEqual({
      provider: 'dobee-deepseek', model: 'deepseek-flash',
    })
    expect(warnings).toEqual([])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
