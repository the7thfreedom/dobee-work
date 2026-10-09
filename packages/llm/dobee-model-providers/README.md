---
description: "Independent dobee connections for native LLM providers and custom OpenAI or Anthropic endpoints."
kind: "package-reference"
---

# @deepseek-ai/dsh-dobee-model-providers

English | [中文](README.zh.md)

## Summary

Configure API providers with an endpoint and key, or authorize a subscription account through its sign-in flow. Multiple connections can use the same provider without sharing their account grants. Requests use the dobee adapter directly, without invoking another Harness model plugin. Keys and subscription tokens remain in the shared credential store.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The dobee Models settings page edits the `dobee-model-providers` namespace. Each `connections` key becomes a `dobee-<key>` provider route. Native `source` values inherit the installed pi-ai model catalog and protocol dispatch. Custom API connections declare an endpoint and protocol, then synchronize or manually add models.

| Field | Meaning |
|---|---|
| `kind` | `api` or `subscription`; GitHub Copilot uses subscription authentication |
| `enabled`, `enabledModels` | Provider enablement and selected model ids; null model selection uses the full catalog |
| `source` | Native provider or dobee preset id |
| `displayName` | Connection name shown in model pickers |
| `api` | Optional OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages protocol override |
| `baseURL` | Optional endpoint override without embedded credentials |
| `apiKeyEnv` | Credential reference, not a secret |
| `models` | Explicit model catalog; omitted native catalogs are inherited |
| `timeoutMs` | Request timeout |
| `imagePixelBudget`, `imageMaxBytes`, `maxRequestImageBytes` | Per-image normalization and aggregate payload limits |

The initial connection is `dobee-deepseek`, referencing `DOBEE_DEEPSEEK_API_KEY`. Native connections derive `DOBEE_<CONNECTION_ID>_API_KEY` when no reference is supplied and never fall back to an unrelated ambient key. A missing referenced key fails with `MISSING_CREDENTIAL`. Settings changes apply to subsequent requests; prepared calls retain their original connection generation.

Model synchronization queries the configured endpoint and returns candidates without writing connection settings. Native catalogs are separately available offline. The provider manager handles Gemini and Anthropic pagination, bounded by `maxModelPages`. Listing models does not verify inference.

GitHub Copilot presents a device-login link and code, then stores the authorized account grant on the Host. The public Copilot device client is the default `copilotClientId`; a deployment can select its registered client. Copilot's internal token exchange is not a stable public inference API. Requests use the account endpoint and refresh the short-lived token under the credential record's cross-process lock. Copilot requires a registered IDE compatibility profile; requests use the pinned library's profile fields while User-Agent identifies dobee. Account model synchronization excludes disabled models, not client-specific picker flags, and retains availability beside the grant. Logout removes that connection's grant. The UI receives account metadata and device instructions, never tokens.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

Each connection captures its model metadata and a private provider-library collection. The adapter converts Harness history into native messages, restores same-route signatures, translates stream events, and disables SDK retries so Harness retry policy owns attempts. Subscription replay also checks an opaque account-and-endpoint identity. The [Remote controller](../../api/dobee-model-controller/README.md) keeps generated wire types separate from native SDK implementations.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [LLM service](../llm/README.md) — shared model-call semantics.
- [Credentials](../../credentials/credentials/README.md) — secret storage.
- [Implementation plan](../../../docs/discussion/dobee-model-providers.md) — intended scope and acceptance.

<a id="model-experience"></a>
## Model Experience

### Provider requests

#### What the model sees

The selected `dobee-<connection>` model receives logged system instructions, user and assistant history, tool declarations, correlated tool results, and supported images. Each image carries its durable attachment descriptor. Unsupported content and stop sequences fail explicitly.

#### Token effect

Provider tokenization determines usage; image descriptors add text tokens. Cache-read and cache-write counts remain separate from uncached input.

#### KV Cache effect

Same-route native signatures are retained. Changing model or connection can invalidate native replay and provider cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- GitHub Copilot is the implemented subscription provider; other subscription products need separate authorization and request adapters.
- Copilot's internal APIs and public device client can change; authorization and inference remain subject to account subscription and organization policies.
- Deferred tool updates, arbitrary request templates, cloud credential chains, and automatic cross-provider fallback are unsupported.
- Catalogs that exceed the configured page limit are refused rather than silently truncated.

<a id="dev-note"></a>
### Dev Note

None.
