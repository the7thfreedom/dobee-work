---
description: "Guide automation creation with task and timing fields before opening an unsent conversation draft."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-dobee-ui-schedule

English | [中文](README.zh.md)

## Summary

Create automation tasks through a guided conversation rather than opening an unexplained blank chat. Enter what to do and when, then review and send the prepared request. The guide distinguishes draft preparation from successful task creation and explains where to manage the result.

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

The Web bundle mounts this plugin for Web and desktop. It has no configuration fields.

Both catalog creation entries say “Create through chat” and open the same guide. Task content and timing are required; whitespace alone does not enable continuation. Examples show an instruction and a repeat schedule, with a hint to include a time zone when needed. Cancel, Escape, the close button, or clicking outside dismisses the guide without opening a conversation.

“Continue to conversation” prepares a localized, unsent request through the existing Workspace navigation. Existing conversation drafts are preserved. The user must review and send the message; this action does not create a schedule or report success. The guide explains that the assistant may ask for details, a task card confirms creation, and Automation tasks provides viewing, editing, and deletion.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin occupies the shared catalog's `schedule.manager.creation` slot for its header and empty-state placements. Local form state belongs to each entry. Workspace navigation initializes the draft without clearing existing content; scheduling, persistence, and the created-task card stay with their existing owners. Removing this plugin restores the catalog's default creation actions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Task catalog](../ui-schedule/README.md) — viewing and managing tasks.
- [Workspace](../ui-workspace/README.md) — Session navigation and draft initialization.
- [Schedule](../../schedule/schedule/README.md) — persistence and delivery.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package prepares an editable draft without submitting it; ordinary conversation submission owns model-visible input.

#### KV Cache effect

None until the user sends the draft as an ordinary message.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Creation requires an assistant with scheduling tools; the guide is not a direct scheduling form.
- Timing is free text for the assistant to interpret or clarify, not a validated schedule.
- Form fields survive dismissal while the entry remains mounted, but are not persisted across page navigation or reload.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
