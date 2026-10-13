---
description: "Show DobeeWork typography in browser sidebar and conversation brand slots without upstream official artwork."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-dobee-brand

English | [中文](README.zh.md)

## Summary

Use this package to show DobeeWork in the sidebar and the empty conversation. It works in both local and official builds without upstream official artwork. It does not change model prompts, accounts, or workspaces.

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

The Web bundle mounts this plugin for Web and desktop profiles. Do not mount the upstream official brand plugin alongside it.

```yaml
- name: '@deepseek-ai/dsh-client-dobee-brand'
```

The plugin has no configuration fields. Browser builds can explicitly override the page title through `DSH_CLIENT_TITLE`; the default title is DobeeWork.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser contributes localized typography to the sidebar and hero slots; registrations follow declarations and dispose with the plugin. Its Host entry is an inert Loader seat. The independent [identity plugin](../../core/dobee-brand-identity/README.md) owns model-facing product text.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [System prompt](../../core/system-prompt/README.md) — prompt composition and complete-prompt semantics.
- [Sidebar](../ui-sidebar/README.md) — brand-slot geometry.
- [Conversation](../ui-conversation/README.md) — the empty-conversation hero.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package contributes browser presentation only.

#### KV Cache effect

None; this package neither assembles nor sends model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Brand slots only** — desktop shell text, packaging metadata, and browser page titles remain with their respective owners.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
