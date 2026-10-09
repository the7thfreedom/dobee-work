---
description: "Dobee model-provider runtime and settings UI composition for Desktop."
kind: "package-bundle"
---

# @deepseek-ai/dsh-dobee-models

English | [中文](README.zh.md)

## Summary

Use dobee model connections and their settings page in Desktop. This bundle adds the independent dobee provider runtime and browser UI to an existing Web composition. Its initial default model is `dobee-deepseek/deepseek-flash`; explicit profile settings take precedence.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Dobee Desktop includes this bundle after the upstream Web bundles. Configure the DeepSeek connection in the dobee settings page or select another configured default. The initial connection references `DOBEE_DEEPSEEK_API_KEY`; native welcome key entry writes that reference when this route is the default. Existing official model routes remain mounted for historical sessions.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [patch](cordis.patch.yml) inserts the dobee provider runtime, Remote controller, and UI plugins, then overrides the default-model row. No upstream plugin implementation is changed.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Provider runtime](../../llm/dobee-model-providers/README.md)
- [Settings UI](../../client/dobee-ui-model-providers/README.md)
- [Default-model migration](../../../docs/upgrade-guide/v0.2.1-alpha.1/dobee-default-models/guide.md)

<a id="model-experience"></a>
## Model Experience

### Composed model requests

#### What the model sees

The `dobee-model-providers` adapter owns model-visible requests; the bundle adds no prompt content.

#### Token effect

None directly; the selected model and its adapter determine token use.

#### KV Cache effect

Selecting a different default affects new sessions, not the persisted history of existing sessions.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This bundle requires the existing Web and base services; it is not a standalone application.
- Source packaging includes the bundle, but non-Desktop profiles do not automatically select it.
- Real-provider and Copilot account verification require authorized credentials.

<a id="dev-note"></a>
### Dev Note

None.
