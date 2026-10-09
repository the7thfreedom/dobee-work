---
description: "Authenticated Remote access to dobee API and subscription provider management."
kind: "package-reference"
---

# @deepseek-ai/dsh-dobee-model-controller

English | [中文](README.zh.md)

## Summary

Read provider defaults, synchronize model catalogs, and authorize subscription accounts through the application's authenticated Remote transport. Device instructions and account metadata cross to the initiating UI; access tokens and refresh credentials stay on the Host.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The dobee bundle mounts this controller alongside the provider manager. Browser plugins mount its generated `./remote` contribution to access `remote.dobeeModels`. API synchronization accepts staged endpoint and key inputs. Subscription login takes a saved connection and streams public device instructions, then authorization or cancellation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The controller delegates to `ctx.dobeeProviderManager` and carries no native SDK or credential store implementation. Generated codecs own wire validation; the provider manager owns source selection, authentication, and model listing.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Provider manager](../../llm/dobee-model-providers/README.md)
- [Typert protocol](../../typert/protocol/README.md)
- [Settings UI](../../client/dobee-ui-model-providers/README.md)

<a id="model-experience"></a>
## Model Experience

### Provider management

#### What the model sees

`remote.dobeeModels` management calls do not submit prompts or change the Session log.

#### Token effect

No model tokens are consumed by catalog or authorization operations.

#### KV Cache effect

None directly; model selection and account changes take effect through the provider adapter.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Login attempts are process-local and must be restarted after a Host restart or client disconnect.
- Subscription support is limited to the implementations supplied by the provider manager.

<a id="dev-note"></a>
### Dev Note

None.
