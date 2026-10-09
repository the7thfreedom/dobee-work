# Dobee model providers implementation plan

English | [中文](dobee-model-providers.zh.md)

## Summary

Dobee owns a multi-provider runtime and a localized model-management page. Its requests register directly with `ctx.llm`; neither `llm-pi-ai` nor the official DeepSeek adapter executes dobee routes. Shared settings, credentials, session recording, retry policy, and UI primitives remain Harness services. This document specifies the intended implementation; package READMEs describe delivered behavior.

## Table of Contents

- [Runtime](#runtime)
- [Provider coverage](#provider-coverage)
- [User interface](#user-interface)
- [Default composition](#default-composition)
- [Acceptance](#acceptance)
- [Dev Note](#dev-note)

<a id="runtime"></a>
## Runtime

`dobee-model-providers` owns a `connections` dictionary. Each connection has a stable id, a source provider or explicit protocol, optional endpoint override, credential reference, and model overrides. Multiple connections can select the same source provider without losing native protocol dispatch. The pi-ai library supplies provider transports; dobee owns Harness message conversion, stream translation, error mapping, model metadata, and durable replay. No upstream plugin implementation is changed.

Connection ids are prefixed with `dobee-` when registered with `ctx.llm`. Settings contain credential references only. Requests capture their connection and model before asynchronous work. Missing referenced credentials fail explicitly. Changes apply to subsequent requests; no cross-provider fallback is automatic. Registrations and subscriptions unwind on plugin disposal.

Custom routes support OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages. Unsupported request options fail rather than disappearing. Model discovery returns candidates without changing settings. Missing endpoint metadata requires explicit model declarations. Images require actual model support and attachment access; no declaration may advertise an unsupported implementation.

<a id="provider-coverage"></a>
## Provider coverage

The target catalog includes OpenAI, Anthropic, Google Gemini, DeepSeek, Qwen, Doubao, Zhipu, Moonshot/Kimi, MiniMax, OpenRouter, SiliconFlow, and GitHub Copilot. Installed library catalogs supply defaults where available; compatible providers absent from that catalog have explicit presets and user-editable model ids. Domestic and international endpoints remain distinct choices.

GitHub Copilot is distinct from the retired GitHub Models API. Copilot uses device authorization, Host-owned account grants, automatic token exchange, and model-specific protocol selection. Its public device client is the configurable default. The internal API requires a registered IDE compatibility profile; requests retain dobee application attribution. Authentication success, model-list success, and inference success are separately verified.

<a id="user-interface"></a>
## User interface

`dobee-ui-model-providers` registers an independent two-pane settings section: a searchable provider list with API and Subscription filters on the left, and the selected provider's connection and models on the right. API providers expose Endpoint and Key; subscription providers expose sign-in, account status, cancellation, and logout without token inputs. Models are synchronized, enabled with checkboxes, and selected as defaults from the actual list. Internal ids and credential references stay out of the regular UI; protocol and capacity overrides are advanced settings. The independent Remote controller delegates to the Host manager; browser code never contacts model providers directly.

Credentials start empty and are not read back. Save failures retain drafts. Settings writes carry the revision read when editing began. Brand identity and connection display name are separate. Model choices appear in the existing composer directory. A model-listing success is not an inference test; tests that send a prompt require a cost notice and a durable request record.

<a id="default-composition"></a>
## Default composition

A dobee-owned bundle inserts the provider and UI plugins and changes the default-model configuration through a composition overlay, not through edits to upstream plugin code. Existing official routes remain available for historical sessions. Initial defaults do not issue network requests or silently select a different paid provider. Desktop verification uses an isolated Harness home and Electron user-data directory.

<a id="acceptance"></a>
## Acceptance

1. Compile Host and Client programs and exercise valid and invalid connection settings.
2. Exercise native and custom protocol streaming, tool arguments, usage, cancellation, error endings, replay, configuration changes, and disposal.
3. Boot the plugin through the real Loader and confirm registered dobee routes and model discovery.
4. Verify save, restart restoration, multi-connection identity, default selection, and removal through the UI.
5. Start Desktop with the dobee bundle, inspect the actual rendered page, and verify a real model call when an authorized credential is available.
6. Report unavailable credentials, Copilot authorization, platform interaction, or GUI automation as unverified; mocks do not establish real-provider availability.

<a id="dev-note"></a>
## Dev Note

Implementation evidence belongs in tests and package documentation. Cherry Studio's provider behavior is a reference, not copied AGPL source. Cloud credential chains, arbitrary JSON request templates, automatic cross-provider fallback, and a composer context-window selector are outside this implementation.
