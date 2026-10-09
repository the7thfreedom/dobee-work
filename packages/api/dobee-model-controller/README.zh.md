---
description: "通过已认证 Remote 管理 dobee API 与订阅服务商。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dobee-model-controller

[English](README.md) | 中文

## 概述

通过应用的已认证 Remote 传输读取服务商默认值、同步模型目录和授权订阅账号。设备指引和账号信息发送到发起操作的 UI；访问令牌及刷新凭据保留在 Host。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

dobee bundle 将此控制器与服务商管理器一起挂载。浏览器插件挂载生成的 `./remote` 贡献，以访问 `remote.dobeeModels`。API 同步接受草稿中的端点和密钥。订阅登录使用已保存的连接，并流式发送公开设备指引及授权或取消结果。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

控制器委托给 `ctx.dobeeProviderManager`，不包含原生 SDK 或凭据存储实现。生成的编解码器负责通信验证；服务商管理器负责来源选择、认证和模型列表。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [服务商管理器](../../llm/dobee-model-providers/README.zh.md)
- [Typert 协议](../../typert/protocol/README.zh.md)
- [设置 UI](../../client/dobee-ui-model-providers/README.zh.md)

<a id="model-experience"></a>
## 模型体验

### 服务商管理

#### 模型看到什么

`remote.dobeeModels` 管理调用不发送提示，也不改变 Session 日志。

#### Token 影响

目录和授权操作不消耗模型 Token。

#### KV Cache 影响

无直接影响；模型选择和账号变更通过服务商适配器生效。

## 已知限制和延期工作

<a id="known-limitations-and-deferred-work"></a>

- 登录尝试只在当前进程有效，Host 重启或客户端断开后需要重新发起。
- 订阅支持限于服务商管理器提供的实现。

<a id="dev-note"></a>
### 开发备注

无。
