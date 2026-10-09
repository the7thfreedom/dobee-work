/** Harness history conversion with validated native replay and durable image access. */
import type { AssistantMessage as PiAssistant, Context as PiContext, Message as PiMessage, TextContent, ImageContent, JsonObject } from '@earendil-works/pi-ai'
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import type { AttachmentStore, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import { LlmError, offloadedImageText, requestImageHandleText, requiredImageOffload } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, ImageAttachmentAccessResolver, ReplayEnvelope } from '@deepseek-ai/dsh-llm'
import type { Connection } from './config.ts'

const zeroUsage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonObject(value: unknown): value is JsonObject {
  return record(value) && isJsonValue(value)
}
/**
 * Capture native response and block signatures without persisting the mutable SDK response.
 * @param message - completed native assistant response.
 * @param requestedModel - model identifier used for this request.
 * @param authScope - opaque subscription account and endpoint identity, when applicable.
 * @returns versioned, JSON-compatible native replay metadata.
 */
export function replayOf(message: PiAssistant, requestedModel: string, authScope?: string): ReplayEnvelope {
  return {
    response: {
      version: 1, provider: message.provider, api: message.api, model: requestedModel,
      ...authScope === undefined ? {} : { authScope },
      ...message.responseId === undefined ? {} : { responseId: message.responseId },
      ...message.providerThinkingLevel === undefined ? {} : { providerThinkingLevel: message.providerThinkingLevel },
      ...message.responseModel === undefined ? {} : { responseModel: message.responseModel },
    },
    blocks: message.content.map((block) => {
      if (block.type === 'thinking') return {
        type: block.type,
        ...block.thinkingSignature === undefined ? {} : { thinkingSignature: block.thinkingSignature },
        ...block.redacted === undefined ? {} : { redacted: block.redacted },
      }
      if (block.type === 'text') return {
        type: block.type,
        ...block.textSignature === undefined ? {} : { textSignature: block.textSignature },
      }
      return {
        type: block.type,
        ...block.thoughtSignature === undefined ? {} : { thoughtSignature: block.thoughtSignature },
        ...block.namespace === undefined ? {} : { namespace: block.namespace },
      }
    }),
  }
}

/**
 * Convert logged request content to the native SDK without changing the log.
 * @param options - immutable Harness request.
 * @param connection - captured connection generation.
 * @param attachments - durable image provider, when composed.
 * @param imageAccess - current execution-world image access.
 * @param authScope - subscription identity used to refuse another account's cached response metadata.
 * @returns native request history with tool correlation and same-route signatures.
 */
export async function contextOf(
  options: GenerateOptions,
  connection: Connection,
  attachments: AttachmentStore | undefined,
  imageAccess: ImageAttachmentAccessResolver,
  authScope?: string,
): Promise<PiContext> {
  const versions = new Map<string, RequestImageAttachment>()
  for (const message of options.messages) {
    for (const block of message.content) {
      if (block.type !== 'image' || block.offloaded || versions.has(block.attachment.attachmentId)) continue
      if (attachments === undefined) throw new LlmError('Image requests require an attachment provider', 'UNSUPPORTED_CONTENT')
      const { imagePixelBudget, imageMaxBytes } = connection.config
      const version = await attachments.readImageRequest(block.attachment, {
        ...requestImageDimensions(block.attachment.width, block.attachment.height, imagePixelBudget),
        maxBytes: imageMaxBytes,
      }, options.signal)
      versions.set(block.attachment.attachmentId, version)
    }
  }
  const imageLimit = connection.config.maxRequestImageBytes
  if (versions.size > 0) {
    const offloadImages = requiredImageOffload(options.messages, { representation: 'base64', maxBytes: imageLimit }, (block) => {
      const version = versions.get(block.attachment.attachmentId)
      if (version === undefined) throw new LlmError('Request image is unavailable', 'UNSUPPORTED_CONTENT')
      return version.bytes
    })
    if (offloadImages > 0) throw new LlmError('Request images exceed the configured byte limit', 'IMAGE_OFFLOAD_REQUIRED', { offloadImages })
  }
  const userContent = (blocks: readonly ContentBlock[]): (TextContent | ImageContent)[] => blocks.flatMap(
    (block): (TextContent | ImageContent)[] => {
      switch (block.type) {
        case 'text': return [{ type: 'text', text: block.text }]
        case 'image': {
          if (block.offloaded) return [{ type: 'text', text: offloadedImageText(block.attachment, imageAccess(block.attachment)) }]
          const version = versions.get(block.attachment.attachmentId)
          if (version === undefined) throw new LlmError('Request image is unavailable', 'UNSUPPORTED_CONTENT')
          return [
            { type: 'text', text: requestImageHandleText(block.attachment, version, imageAccess(block.attachment)) },
            { type: 'image', data: Buffer.from(version.data).toString('base64'), mimeType: version.mediaType },
          ]
        }
        default: throw new LlmError(`Unsupported user content "${block.type}"`, 'UNSUPPORTED_CONTENT')
      }
    },
  )
  const messages: PiMessage[] = []
  const toolNames = new Map<string, string>()
  for (const message of options.messages) {
    switch (message.role) {
      case 'system':
        messages.push({ role: 'system', content: userContent(message.content).map((block) => {
          if (block.type !== 'text') throw new LlmError('System images are unsupported', 'UNSUPPORTED_CONTENT')
          return block.text
        }).join(''), timestamp: 0 })
        break
      case 'user':
        messages.push({ role: 'user', content: userContent(message.content), timestamp: 0 })
        break
      case 'tool': {
        const name = toolNames.get(message.toolCallId)
        if (name === undefined) throw new LlmError(`Tool result "${message.toolCallId}" has no preceding call`, 'INVALID_REQUEST')
        messages.push({
          role: 'toolResult', toolCallId: message.toolCallId, toolName: name,
          content: userContent(message.content), isError: message.isError ?? false, timestamp: 0,
        })
        break
      }
      case 'assistant': {
        const stored = message.source.replayState
        const envelope = record(stored) ? stored : undefined
        const response = envelope?.response
        const blocks: readonly unknown[] | undefined = Array.isArray(envelope?.blocks) ? envelope.blocks : undefined
        const reusable = message.source.provider === connection.route && message.source.model === options.model
          && record(response) && response.version === 1 && response.model === message.source.model
          && response.provider === connection.provider.id
          && response.api === connection.models.find(model => model.id === options.model)?.api
          && (connection.config.kind !== 'subscription' || authScope !== undefined && response.authScope === authScope)
          && blocks?.length === message.content.length
        const content: PiAssistant['content'] = message.content.map((block, index) => {
          const metadata: unknown = reusable ? blocks[index] : undefined
          switch (block.type) {
            case 'text': return {
              type: 'text', text: block.text,
              ...record(metadata) && metadata.type === 'text' && typeof metadata.textSignature === 'string'
                ? { textSignature: metadata.textSignature } : {},
            }
            case 'reasoning': return {
              type: 'thinking', thinking: block.text,
              ...record(metadata) && metadata.type === 'thinking' && typeof metadata.thinkingSignature === 'string'
                ? { thinkingSignature: metadata.thinkingSignature } : {},
              ...record(metadata) && metadata.redacted === true ? { redacted: true } : {},
            }
            case 'tool-call': {
              const args: unknown = JSON.parse(block.arguments)
              if (!jsonObject(args)) throw new LlmError(`Tool "${block.name}" arguments are not a JSON object`, 'INVALID_REQUEST')
              toolNames.set(block.id, block.name)
              return {
                type: 'toolCall', id: block.id, name: block.name, arguments: args,
                ...record(metadata) && metadata.type === 'toolCall' && typeof metadata.thoughtSignature === 'string'
                  ? { thoughtSignature: metadata.thoughtSignature } : {},
                ...record(metadata) && metadata.type === 'toolCall' && typeof metadata.namespace === 'string'
                  ? { namespace: metadata.namespace } : {},
              }
            }
            default: throw new LlmError(`Unsupported assistant content "${block.type}"`, 'UNSUPPORTED_CONTENT')
          }
        })
        messages.push({
          role: 'assistant', content, usage: zeroUsage, timestamp: 0,
          provider: reusable && record(response) && typeof response.provider === 'string' ? response.provider : message.source.provider,
          api: reusable && record(response) && typeof response.api === 'string' ? response.api : 'dobee-neutral',
          model: message.source.model,
          stopReason: content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop',
          ...reusable && record(response) && typeof response.responseId === 'string' ? { responseId: response.responseId } : {},
          ...reusable && record(response) && typeof response.responseModel === 'string' ? { responseModel: response.responseModel } : {},
          ...reusable && record(response) && typeof response.providerThinkingLevel === 'string'
            ? { providerThinkingLevel: response.providerThinkingLevel } : {},
        })
        break
      }
      case 'developer':
        throw new LlmError('This adapter does not support deferred tool updates', 'UNSUPPORTED_CONTENT')
    }
  }
  if (options.tools?.some(tool => tool.deferLoading)) throw new LlmError('Deferred tools are unsupported', 'UNSUPPORTED_CONTENT')
  return {
    ...options.system === undefined ? {} : { systemPrompt: options.system },
    messages,
    ...options.tools === undefined ? {} : {
      tools: options.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
    },
  }
}
