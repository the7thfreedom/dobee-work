---
description: "Configure API providers with Endpoint and API Key, sign in to GitHub Copilot subscriptions, and select available models in localized settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-dobee-ui-model-providers

English | [中文](README.zh.md)

## Summary

Use **dobee model providers** in Settings to configure API providers or connect a GitHub Copilot subscription. Search the provider sidebar, configure Endpoint and API Key or sign in, sync models, and choose a default from the available list. API keys and subscription tokens remain separate from provider settings. Failed writes retain your draft.

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

The Settings section appears while the Host serves `dobee-model-providers`; the composition must include this browser companion, the independent Host provider and model controller, the settings shell, locale, and API remotes. The browser companion mounts `@deepseek-ai/dsh-dobee-model-controller/remote` before registering its UI.

### Connections and credentials

Select a saved provider or a preset in the left sidebar. **API** and **Subscription** filters narrow the list. API presets prefill their Endpoint; enter an API Key or keep a configured credential, then save. **Add custom provider** creates an API provider using OpenAI Chat Completions; protocol, timeout, and manual model capacities are in **Advanced settings**. Provider IDs are generated automatically, and existing IDs remain unchanged.

The API Key input never displays a stored secret. Leaving it empty keeps an existing configured credential; the status reports presence only. GitHub Copilot instead offers **Sign in with GitHub** without Endpoint, API Key, or token fields. Sign-in saves the provider first, then shows a browser authorization link and device code. **Cancel sign-in** stops polling; a completed sign-in refreshes account status and syncs models. Saved account status is restored when the provider is selected again.

### Models and default selection

Saved providers load their installed or declared model catalog without live network access. **Sync models** contacts the provider through the Host and fills the model list directly. Each checkbox controls model availability. Provider-returned protocols, capacities, input modalities, and reasoning metadata remain in the saved declarations; undisclosed metadata remains omitted. Subscription sync requires a signed-in account and refreshes expired access; failed renewal may require signing in again.

Save provider and checkbox changes before choosing **Set as default** on an enabled model in the actual list. The default uses the existing `agent-default-model` namespace; there is no free-text default ID. Delete requires confirmation, signs out an owned subscription account before removing its settings, and retains shared API keys; the current default provider cannot be deleted until another default is selected. **Sign out** clears subscription authorization without changing API credentials.

### Configuration

This UI plugin has no configuration fields. It edits the Host provider's namespace through shared configuration forms. Drafts survive provider selection changes and settings-panel remounts. Conflict and failure outcomes retain the draft. If configuration commits but credential storage fails, **Retry credential save** writes only the pending credential; provider editing and selection remain locked until that stage succeeds.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host entry has an empty `apply`. The browser entry mounts the generated remote and registers a `settings.section` contribution and a `shell.overlay` toast host. Framework hooks bind controller state; components receive plain actions rather than Cordis context. Existing provider edits mutate only editor-owned field paths, preserving Host-only image budgets and other unseen settings. API credentials use the credentials remote; catalogs, live sync, and account authorization use the independent `dobeeModels` remote.

| Source | Responsibility |
|---|---|
| [controller.ts](src/client/controller.ts) | Validation, draft retention, revision fences and staged writes |
| [Section.tsx](src/client/Section.tsx) | Localized settings editor and confirmation |
| [mount.ts](src/client/mount.ts) | Joined remote/UI lifecycle and Host callbacks |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [UI settings](../ui-settings/README.md) — configuration forms and namespace availability.
- [UI primitives](../ui-primitives/README.md) — controls, confirmation and toast presentation.
- [Credentials](../../credentials/README.md) — secret storage and presence reports.

-----

<a id="model-experience"></a>
## Model Experience

### Connection settings

#### What the model sees

This UI registers no tools, prompts or model-visible messages; the Host provider supplies the selected model through its saved `dobee-<connection-id>` route.

#### Token effect

The editor and model discovery add no tokens to model requests.

#### KV Cache effect

None; discovery does not send an inference request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Inference** — model sync is not an inference test; catalog membership does not establish that a credential or model can complete a request.
- **API credential cleanup** — deletion retains stored API keys because references can be shared; subscription grants are signed out before removal.
- **Subscription scope** — GitHub Copilot is the only subscription preset; account access and the provider's internal API limitations are owned by the [Host provider](../../llm/dobee-model-providers/README.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
