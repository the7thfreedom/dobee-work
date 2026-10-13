---
description: "Identify DobeeWork in harness-owned system prompts while preserving complete prompts and deployment personas."
kind: "package-reference"
---

# @deepseek-ai/dsh-dobee-brand-identity

English | [中文](README.zh.md)

## Summary

Use this package to identify DobeeWork in model prompts without changing deployment personas or adding browser dependencies. Profiles that omit the harness identity and explicit complete prompts remain unchanged. It adds no tools or runtime context.

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

The shared base bundle mounts this plugin in Web, desktop, headless, SDK, and ACP profiles.

```yaml
- name: '@deepseek-ai/dsh-dobee-brand-identity'
```

The plugin has no configuration fields. The existing system-prompt configuration still decides whether a harness identity is present.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The cooperative prompt-assembly waterfall replaces only the upstream default text in `harness:identity`; custom scoped identities remain unchanged. Complete-prompt restoration remains with the registry. Rendering and Session logging retain their existing owners, so the changed text is recorded through the ordinary system-message path.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [System prompt](../system-prompt/README.md) — assembly and complete-prompt semantics.
- [Base bundle](../../bundle/base/README.md) — shared profile composition.
- [Browser brand](../../client/dobee-brand/README.md) — independent UI presentation.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt identity

#### What the model sees

The model receives this fixed opener before the deployment persona, unless the composition omits it or supplies a complete prompt.

##### Harness identity

```markdown
You are an AI agent powered by DobeeWork.
```

#### Token effect

The fixed identity replaces the upstream identity text. It contributes nothing when the harness identity is omitted or a complete prompt takes precedence.

#### KV Cache effect

The changed identity affects the early system-prompt prefix. Existing Sessions reconcile it through the normal prompt-update rules; provider cache reuse is not guaranteed.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Existing text ownership** — explicit complete prompts and other plugins' persona text retain their original wording. This plugin does not rewrite historical Session data.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
