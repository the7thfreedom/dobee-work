/** Generated methods and the settings contributions withdraw as one Client lifecycle. */
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { expect, it, vi } from 'vitest'
import { mountProviders, inject } from '../src/client/mount.ts'
import { apply as hostApply } from '../src/index.ts'
import { Section } from '../src/client/Section.tsx'
import type { Face } from '../src/client/Section.tsx'
import type { DefaultModel, DobeeProviderSettings } from '../src/client/controller.ts'

const REMOTE: TypertRemoteContribution = { package: '@deepseek-ai/dsh-dobee-model-controller', descriptors: [] }

function form<T>(value: T, off = vi.fn()): ConfigForm<T> {
  return {
    getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, mode: 'host', value, base: {}, user: {} }),
    subscribe: vi.fn(() => off),
    mutate: vi.fn(async () => true),
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
  }
}

function assertFace(value: Record<string, unknown>): asserts value is Record<string, unknown> & Face {
  assert(typeof value.hooks === 'object' && value.hooks !== null)
  for (const key of ['open', 'edit', 'cancel', 'save', 'discover', 'remove', 'setDefault', 'toggleModel',
    'login', 'cancelLogin', 'logout', 'loadPresets', 'refreshInfo', 'refreshCredential', 'dismiss']) {
    assert(typeof value[key] === 'function')
  }
}

async function fixture(fail = false) {
  const ctx = new Context()
  const unmount = vi.fn(async () => {})
  const off = vi.fn()
  const settings = form<DobeeProviderSettings>({ connections: { deepseek: { source: 'deepseek' } } }, off)
  const defaults = form<DefaultModel>({ provider: 'old', model: 'old' })
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    $on = vi.fn(() => vi.fn())
    async $mount(contribution: TypertRemoteContribution) {
      expect(contribution).toBe(REMOTE)
      ctx.provide('remote.dobeeModels', {
        presets: async () => ({ ok: true, value: [{ source: 'deepseek', kind: 'api', baseURL: 'https://api.deepseek.com' }] }),
        catalog: async () => ({ ok: true, value: [{ id: 'deepseek-chat' }] }),
      })
      return unmount
    }
  }
  new Remote()
  ctx.provide('remote.credentials', { describe: async () => ({ ok: true, value: {} }) })
  ctx.provide('configForms', {
    get: (namespace: string) => namespace === 'dobee-model-providers' ? settings : defaults,
    whileServed: (_namespaces: readonly string[], register: () => () => void) => register(),
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  if (fail) vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot failed') })
  return { ctx, unmount, settings, off }
}

it('mounts the independent remote before UI and joins UI withdrawal before remote unmount', async () => {
  const b = await fixture()
  try {
    hostApply(b.ctx)
    const fiber = b.ctx.plugin({ inject, apply: ctx => mountProviders(ctx, REMOTE) })
    await fiber
    const entry = b.ctx.slots.entries('settings.section').find(item => item.component === Section)
    assert(entry?.inject !== undefined)
    const face = entry.inject()
    assertFace(face)
    await vi.waitFor(() => { expect(face.hooks.connections.getSnapshot().draft?.id).toBe('deepseek') })
    expect(b.ctx.slots.entries('shell.overlay')).toHaveLength(1)
    await fiber.dispose()
    expect(b.ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(b.ctx.slots.entries('shell.overlay')).toHaveLength(0)
    expect(face.hooks.connections.getSnapshot().draft).toBeNull()
    expect(b.unmount).toHaveBeenCalledOnce()
    expect(b.off).toHaveBeenCalledOnce()
  } finally { await b.ctx.fiber.dispose() }
})

it('unmounts the generated remote when UI registration fails', async () => {
  const b = await fixture(true)
  try {
    await expect(mountProviders(b.ctx, REMOTE)).rejects.toThrow('slot failed')
    expect(b.unmount).toHaveBeenCalledOnce()
    expect(b.ctx.slots.entries('settings.section')).toHaveLength(0)
  } finally { await b.ctx.fiber.dispose() }
})
