---
kind: upgrade-guide
description: "Dobee Desktop uses an independent model-provider bundle and credential reference for its initial default model."
---

# Dobee Desktop default model providers

English | [中文](guide.zh.md)

## Change

Dobee Desktop includes the dobee model bundle alongside the upstream Web bundles. Its bundle-level initial default changes from `deepseek-official/deepseek-flash` to `dobee-deepseek/deepseek-flash`. The dobee connection uses `DOBEE_DEEPSEEK_API_KEY`, not the upstream reference. Explicit profile settings still override the bundle default. Existing session routes and the official adapters remain available.

## Migration

1. Open the dobee model settings page and configure a credential for the DeepSeek connection, or create another connection and select its default model.
2. To retain the official route, keep or set `agent-default-model` in the Desktop profile's `cordis.patch.yml` to `provider: deepseek-official` and `model: deepseek-flash`.
3. Create a session and confirm the composer shows the intended provider and model. Verify a request using an authorized key; configuring a key alone does not establish inference availability.
