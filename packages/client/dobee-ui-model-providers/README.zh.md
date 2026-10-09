---
description: "在本地化设置中通过 Endpoint 和 API Key 配置 API 提供商、登录 GitHub Copilot 订阅并选择可用模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-dobee-ui-model-providers

[English](README.md) | 中文

## 概述

在设置中的 **dobee 模型提供商** 页面配置 API 提供商或连接 GitHub Copilot 订阅。搜索左侧提供商，配置 Endpoint 和 API Key 或登录账号，同步模型并从可用列表中选择默认模型。API 密钥和订阅令牌与提供商设置分开保存。写入失败时保留草稿。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

Host 提供 `dobee-model-providers` 命名空间时，设置页面才会出现；组合需要包含此浏览器配套插件、独立的 Host 提供商与模型控制器、设置框架、区域语言和 API 远程服务。浏览器配套插件先挂载 `@deepseek-ai/dsh-dobee-model-controller/remote`，再注册 UI。

### 连接与凭据

从左侧选择已保存的提供商或预设。**API** 和**订阅**筛选器缩小列表范围。API 预设预填 Endpoint；输入 API Key 或保留已配置的凭据后保存。**添加自定义提供商**创建使用 OpenAI Chat Completions 的 API 提供商；协议、超时和手动模型容量位于**高级设置**。提供商 ID 自动生成，已有 ID 保持不变。

API Key 输入框不会显示已保存的密钥。留空保留已有的已配置凭据；状态只报告是否存在。GitHub Copilot 提供**通过 GitHub 登录**，不显示 Endpoint、API Key 或令牌字段。登录先保存提供商，再显示浏览器授权链接和设备验证码。**取消登录**停止轮询；授权完成后刷新账号状态并同步模型。再次选择提供商时恢复已保存的账号状态。

### 模型与默认选择

已保存的提供商无需实时网络访问即可加载已安装或已声明的模型目录。**同步模型**通过 Host 联系提供商并直接填充模型列表。各复选框控制模型是否可用。提供商返回的协议、容量、输入类型和推理元数据保留在已保存的声明中；未公布的元数据保持省略。同步订阅模型需要已登录的账号，并会刷新过期的访问权限；续期失败时可能需要重新登录。

选择实际列表中已启用模型的**设为默认**之前，请先保存提供商和复选框更改。默认选择使用现有的 `agent-default-model` 命名空间；不提供自由填写默认 ID 的输入框。删除需要确认，先退出所属订阅账号再移除设置，同时保留共用的 API 密钥；选择其他默认模型之前不能删除当前默认提供商。**退出登录**清除订阅授权，不更改 API 凭据。

### 配置

此 UI 插件没有配置字段。它通过共享配置表单编辑 Host 提供商的命名空间。切换提供商或重新挂载设置面板后，草稿仍保留。冲突或失败会保留草稿。如果配置已提交但凭据存储失败，**重试保存凭据**只写入待处理的凭据；在此阶段成功前，提供商编辑和选择保持锁定。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

Host 入口的 `apply` 为空。浏览器入口挂载生成的远程服务，并注册一个 `settings.section` 贡献和一个 `shell.overlay` toast 宿主。框架 hook 绑定控制器状态；组件接收普通操作而非 Cordis 上下文。已有提供商仅修改编辑器拥有的字段路径，保留 Host 专用的图像预算和其他未显示设置。API 凭据使用凭据远程服务；目录、实时同步和账号授权使用独立的 `dobeeModels` 远程服务。

| 源码 | 职责 |
|---|---|
| [controller.ts](src/client/controller.ts) | 校验、草稿保留、修订号检查和分阶段写入 |
| [Section.tsx](src/client/Section.tsx) | 本地化设置编辑器和确认 |
| [mount.ts](src/client/mount.ts) | 远程服务与 UI 的联合生命周期及 Host 回调 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [UI 设置](../ui-settings/README.zh.md) — 配置表单和命名空间可用性。
- [UI 基础组件](../ui-primitives/README.zh.md) — 控件、确认和 toast 展示。
- [凭据](../../credentials/README.zh.md) — 密钥存储和存在状态报告。

-----

<a id="model-experience"></a>
## 模型体验

### 连接设置

#### 模型看到的内容

此 UI 不注册工具、提示词或模型可见消息；Host 提供商通过已保存的 `dobee-<connection-id>` 路由提供选定模型。

#### Token 影响

编辑器和模型发现不会向模型请求添加 token。

#### KV Cache 影响

无；模型发现不发送推理请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **推理** — 模型同步不是推理测试；目录中存在模型不代表凭据或模型能够完成请求。
- **API 凭据清理** — 删除保留已保存的 API 密钥，因为引用可能共享；移除前会退出订阅授权。
- **订阅范围** — GitHub Copilot 是唯一的订阅预设；账号访问和提供商内部 API 的限制由 [Host 提供商](../../llm/dobee-model-providers/README.zh.md)负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
