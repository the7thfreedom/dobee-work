---
description: "供 Desktop 使用的 dobee 模型服务商运行时和设置 UI 组合。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-dobee-models

[English](README.md) | 中文

## 概述

在 Desktop 使用 dobee 模型连接及其设置页。此 bundle 在已有 Web 组合中添加独立 dobee 服务商运行时和浏览器 UI。初始默认模型为 `dobee-deepseek/deepseek-flash`；显式 profile 设置优先。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

Dobee Desktop 在上游 Web bundle 之后加载此 bundle。在 dobee 设置页配置 DeepSeek 连接，或选择其他已配置默认模型。初始连接引用 `DOBEE_DEEPSEEK_API_KEY`。上游原生欢迎页表单配置官方服务商，不配置 dobee；使用其现有的稍后配置操作进入 dobee 设置页。现有官方模型路由继续挂载以支持历史会话。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

[配置补丁](cordis.patch.yml) 插入 dobee 服务商运行时、Remote 控制器和 UI 插件，再覆盖默认模型配置。不修改上游插件实现。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [服务商运行时](../../llm/dobee-model-providers/README.zh.md)
- [设置 UI](../../client/dobee-ui-model-providers/README.zh.md)
- [默认模型迁移](../../../docs/upgrade-guide/v0.2.1-alpha.1/dobee-default-models/guide.zh.md)

<a id="model-experience"></a>
## 模型体验

### 组合后的模型请求

#### 模型看到什么

`dobee-model-providers` 适配器拥有模型可见请求；bundle 不添加提示内容。

#### Token 影响

无直接影响；选定模型及其适配器决定 Token 用量。

#### KV Cache 影响

选择不同默认值影响新会话，不改变已有会话的持久化历史。

## 已知限制和延期工作

<a id="known-limitations-and-deferred-work"></a>

- 此 bundle 依赖已有 Web 和基础服务，不是独立应用。
- 源码打包包含此 bundle，但非 Desktop profile 不会自动选择它。
- 真实服务商及 Copilot 账号验证需要已获授权的凭据。

<a id="dev-note"></a>
### 开发备注

无。
