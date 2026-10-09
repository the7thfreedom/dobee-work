---
description: "独立 dobee 连接支持原生模型服务商及自定义 OpenAI 或 Anthropic 接口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dobee-model-providers

[English](README.md) | 中文

## 概述

使用端点和密钥配置 API 服务商，或通过登录流程授权订阅账号。同一服务商的多个连接不共享账号授权记录。请求直接使用 dobee 适配器，不调用其他 Harness 模型插件。密钥及订阅令牌保存在共享凭据服务中。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

dobee 模型设置页编辑 `dobee-model-providers` 命名空间。每个 `connections` 键对应 `dobee-<key>` 路由。原生 `source` 继承已安装 pi-ai 的模型目录和协议分发。自定义 API 连接声明端点和协议，然后同步或手动添加模型。

| 字段 | 含义 |
|---|---|
| `kind` | `api` 或 `subscription`；GitHub Copilot 使用订阅认证 |
| `enabled`、`enabledModels` | 服务商启用状态和选中的模型标识；空值使用完整目录 |
| `source` | 原生服务商或 dobee 预设标识 |
| `displayName` | 模型选择器中的连接名称 |
| `api` | 可选的 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 协议覆盖 |
| `baseURL` | 可选端点覆盖，不得包含内嵌凭据 |
| `apiKeyEnv` | 凭据引用，不是密钥 |
| `models` | 显式模型目录；未指定时继承原生目录 |
| `timeoutMs` | 请求超时 |
| `imagePixelBudget`、`imageMaxBytes`、`maxRequestImageBytes` | 单图规范化和累计载荷限制 |

初始连接是 `dobee-deepseek`，引用 `DOBEE_DEEPSEEK_API_KEY`。原生连接未指定引用时派生 `DOBEE_<CONNECTION_ID>_API_KEY`，不会回退到无关环境密钥。引用的密钥缺失时返回 `MISSING_CREDENTIAL`。设置变更作用于后续请求；已准备的请求保持原来的连接代次。

模型同步查询配置的端点，只返回候选，不写入连接设置。原生目录另行离线提供。管理器处理 Gemini 和 Anthropic 分页，受 `maxModelPages` 限制。模型列表不验证推理可用性。

GitHub Copilot 展示设备登录链接和验证码，再将已获授权的账号记录存储到 Host。`copilotClientId` 默认使用公开的 Copilot 设备客户端；部署方可以选择已注册的客户端。Copilot 内部令牌交换不是稳定的公开推理 API。请求使用账号端点，并在凭据记录的跨进程锁内刷新短期令牌。Copilot 要求已注册的 IDE 兼容配置；请求使用锁定库的兼容字段，User-Agent 标识 dobee。账号模型同步排除禁用模型，而不是客户端专属选择器标记，并将可用范围记录到授权数据中。退出登录删除该连接的授权。UI 只接收账号信息和设备登录指引，不接收令牌。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

每个连接捕获模型元数据和独立的服务商库集合。适配器将 Harness 历史转换为原生消息，恢复同路由签名，转换流式事件，并禁用 SDK 重试，由 Harness 重试策略管理请求尝试。订阅回放还检查不透明的账号及端点身份。[Remote 控制器](../../api/dobee-model-controller/README.zh.md) 将生成的通信类型与原生 SDK 实现分开。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [LLM 服务](../llm/README.zh.md) — 共享模型调用语义。
- [凭据](../../credentials/credentials/README.zh.md) — 密钥存储。
- [实施方案](../../../docs/discussion/dobee-model-providers.zh.md) — 目标范围和验收。

<a id="model-experience"></a>
## 模型体验

### 服务商请求

#### 模型看到什么

选定的 `dobee-<connection>` 模型接收已记录的系统指令、用户和助手历史、工具声明、关联的工具结果及受支持的图像。每张图像携带持久化附件描述。不支持的内容和停止序列明确报错。

#### Token 影响

服务商分词决定用量；图像描述增加文本 Token。缓存读取和写入计数与未缓存输入分别记录。

#### KV Cache 影响

保留同路由原生签名。切换模型或连接可能使原生回放和服务商缓存无法复用。

## 已知限制和延期工作

<a id="known-limitations-and-deferred-work"></a>

- GitHub Copilot 是已实现的订阅服务商；其他订阅产品需要独立的授权及请求适配器。
- Copilot 内部 API 和公开设备客户端可能变化；授权和推理受账号订阅及组织策略限制。
- 不支持延迟工具更新、任意请求模板、云凭据链及自动跨服务商故障转移。
- 超过配置页数限制的目录明确拒绝，而不是静默截断。

<a id="dev-note"></a>
### 开发备注

无。
