---
kind: upgrade-guide
description: "Dobee Desktop uses an independent model-provider bundle and credential reference for its initial default model."
---

# Dobee Desktop default model providers

English | [中文](guide.zh.md)

## Change

Dobee Desktop includes the dobee model bundle alongside the upstream Web bundles. Its bundle-level initial default changes from `deepseek-official/deepseek-flash` to `dobee-deepseek/deepseek-flash`. The dobee connection uses `DOBEE_DEEPSEEK_API_KEY`, not the upstream reference. The bundle disables `ui-settings-models`, `llm-deepseek`, `llm-deepseek-account`, and `llm-pi-ai`; the dobee settings page is named **Models**. The chat model selector remains available with only dobee routes. Upstream model routes, including those stored in existing sessions or explicit profile defaults, are unavailable.

## Migration

1. Use the native welcome form's configure-later action, then open **Settings → Models** and configure a credential for the DeepSeek connection, or create another connection and select its default model. The native form still configures the official provider and does not write `DOBEE_DEEPSEEK_API_KEY`.
2. Replace any upstream `agent-default-model` selection in the Desktop profile's `cordis.patch.yml` with a configured dobee route, such as `provider: dobee-deepseek` and `model: deepseek-flash`. Select a configured dobee model in each existing session before continuing; session history is retained without automatic route rewriting.
3. Confirm the composer lists only dobee providers and one DeepSeek group for the initial connection. Verify a request using an authorized key; configuring a key alone does not establish inference availability.
