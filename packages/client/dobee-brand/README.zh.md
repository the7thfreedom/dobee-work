---
description: "在浏览器侧栏及会话品牌插槽中显示 DobeeWork 文字，不使用上游官方素材。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-dobee-brand

[English](README.md) | 中文

## 概述

使用本包可在侧栏及空会话中显示 DobeeWork。它同时适用于本地构建及官方构建，不使用上游官方素材。它不改变模型提示词、账号或工作区。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web bundle 为 Web 及桌面 profile 挂载本插件。不要同时挂载上游官方品牌插件。

```yaml
- name: '@deepseek-ai/dsh-client-dobee-brand'
```

本插件没有配置字段。浏览器构建可以通过 `DSH_CLIENT_TITLE` 显式覆盖页面标题；默认标题为 DobeeWork。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

浏览器向侧栏及首屏插槽提供本地化品牌文字；注册跟随声明，并随插件卸载。Host 入口仅为无操作的 Loader 占位。独立的[身份插件](../../core/dobee-brand-identity/README.zh.md)负责模型可见的产品文案。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [System prompt](../../core/system-prompt/README.zh.md) — 提示词组合与完整提示词语义。
- [Sidebar](../ui-sidebar/README.zh.md) — 品牌插槽尺寸。
- [Conversation](../ui-conversation/README.zh.md) — 空会话首屏。

-----

<a id="model-experience"></a>
## Model Experience

无，因为本包仅提供浏览器展示。

#### KV Cache effect

无；本包不装配或发送模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅负责品牌插槽** — 桌面壳文案、打包元数据及浏览器页面标题仍由各自所属模块负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
