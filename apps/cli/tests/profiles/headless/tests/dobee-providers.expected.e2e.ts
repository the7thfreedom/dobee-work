/** Keyless recorded Session output through the shipped headless profile and dobee transport. */
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot'
import { decompressZstdFrame, scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

it('records a dobee model turn without another Harness adapter executing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dobee-profile-'))
  const server = createServer((request, response) => {
    request.resume()
    request.once('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end([
        { choices: [{ index: 0, delta: { role: 'assistant', content: 'DOBEE_PROFILE_OK' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } },
      ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n')
    })
  })
  try {
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Fixture endpoint has no port')
    const patch = join(root, 'dobee.patch.yml')
    await writeFile(patch, [
      '- insert:',
      '    - id: dobee-model-providers',
      "      name: '@deepseek-ai/dsh-dobee-model-providers'",
      '      config:',
      '        connections:',
      '          fixture:',
      '            api: openai-completions',
      `            baseURL: http://127.0.0.1:${address.port}/v1`,
      '            apiKeyEnv: DOBEE_FIXTURE_API_KEY',
      '            models:',
      '              - id: fixture-model',
      '- id: agent-default-model',
      '  config:',
      '    provider: dobee-fixture',
      '    model: fixture-model',
      '- id: session-persistence-jsonl',
      '  config:',
      '    root: .sessions',
      '- id: session-title-llm',
      '  disabled: true',
    ].join('\n') + '\n')
    let normalized: string | undefined
    const result = await runLoaderSmoke({
      label: 'dobee-provider', tempDirPrefix: 'dobee-headless-',
      binScript: fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url)),
      configPath: patch, tsconfigPath: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)),
      sourceImport: 'tsx/esm',
      binArgs: ['--profile', 'headless', '--patch', patch, 'Return the test sentinel.'],
      env: { DOBEE_FIXTURE_API_KEY: 'local-fixture-not-a-real-key', DSH_TELEMETRY_DISABLED: '1' },
      inspect: async (cwd) => {
        const files = await readdir(join(cwd, '.sessions'), { recursive: true })
        const path = files.find(file => file.endsWith('.jsonl.zstd'))
        if (path === undefined) throw new Error('The profile did not persist its Session')
        const compressed = await readFile(join(cwd, '.sessions', path))
        const scanned = scanZstdFrames(compressed)
        expect(scanned.tornStart).toBeUndefined()
        const decoded = await Promise.all(scanned.frames.map(async frame =>
          (await decompressZstdFrame(compressed.subarray(frame.start, frame.end))).toString()))
        const log = decoded.join('')
        const header: unknown = JSON.parse(log.split('\n')[0] ?? '')
        if (!record(header) || typeof header.id !== 'string') {
          throw new Error('Invalid recorded Session header')
        }
        normalized = normalizeSessionSnapshots([log], { cwd, sessionIds: [header.id] }, { nativeWriterOutput: true })[0]
      },
    })
    expect(result.stdout).toContain('DOBEE_PROFILE_OK')
    expect(normalized).toContain('dobee-fixture')
    const expected = fileURLToPath(new URL('./expected/dobee-model-providers/session.expected.jsonl', import.meta.url))
    if (normalized === undefined) throw new Error('No normalized Session was captured')
    if (process.env.DSH_SNAPSHOT === 'refresh') await writeFile(expected, normalized)
    expect(normalized).toBe(await readFile(expected, 'utf8'))
  } finally {
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    server.closeAllConnections()
    await closed
    await rm(root, { recursive: true, force: true })
  }
})
