# Dobee 模型服务商实施方案

[English](dobee-model-providers.md) | 中文

## 摘要

Dobee 拥有多服务商运行时及本地化模型管理页。请求直接注册到 `ctx.llm`；`llm-pi-ai` 和官方 DeepSeek 适配器均不执行 dobee 路由。共享设置、凭据、会话记录、重试策略和 UI 原语仍使用 Harness 服务。本文规定目标实现；包 README 描述已交付行为。

## 目录

- [运行时](#runtime)
- [服务商覆盖](#provider-coverage)
- [用户界面](#user-interface)
- [默认组合](#default-composition)
- [验收](#acceptance)
- [开发备注](#dev-note)

<a id="runtime"></a>
## 运行时

`dobee-model-providers` 拥有 `connections` 字典。每个连接包含稳定标识、源服务商或显式协议、可选端点覆盖、凭据引用和模型覆盖。同一源服务商可建立多个连接，保留原生协议分发。pi-ai 库提供服务商传输；dobee 拥有 Harness 消息转换、流式转换、错误分类、模型元数据和持久化回放。不修改上游插件实现。

连接注册到 `ctx.llm` 时添加 `dobee-` 前缀。设置只包含凭据引用。请求在异步工作前捕获连接和模型。引用凭据缺失时明确报错。变更作用于后续请求；不会自动跨服务商故障转移。插件卸载时撤销注册和订阅。

自定义路由支持 OpenAI Chat Completions、OpenAI Responses 和 Anthropic Messages。不支持的请求选项明确报错，不静默丢弃。模型发现返回候选，不改变设置。缺少端点元数据时需要显式模型声明。图像需要模型实际支持和附件访问；声明不得宣传实现未支持的能力。

<a id="provider-coverage"></a>
## 服务商覆盖

目标目录包括 OpenAI、Anthropic、Google Gemini、DeepSeek、Qwen、Doubao、Zhipu、Moonshot/Kimi、MiniMax、OpenRouter、SiliconFlow 和 GitHub Copilot。已安装库的目录提供可用默认值；目录未包含的兼容服务商使用显式预设和可编辑模型标识。国内和国际端点保持独立选择。

GitHub Copilot 不同于已退役的 GitHub Models API。Copilot 使用设备授权、Host 持有的账号授权、自动令牌交换及模型专属协议选择。公开的设备客户端作为可配置默认值。内部 API 要求已注册的 IDE 兼容配置；请求保留 dobee 应用标识。认证成功、模型列表成功和推理成功分别验证。

<a id="user-interface"></a>
## 用户界面

`dobee-ui-model-providers` 注册独立双栏设置页：左侧是支持 API 和 Subscription 筛选的可搜索服务商列表，右侧展示所选服务商的接入和模型。API 服务商提供 Endpoint 和 Key；订阅服务商提供登录、账号状态、取消和退出登录，不提供令牌输入。同步后的模型通过复选框启用，并从真实列表选择默认值。内部标识和凭据引用不出现在常规 UI；协议和容量覆盖放在高级设置。独立 Remote 控制器委托给 Host 管理器；浏览器不直接联系模型服务商。

凭据输入初始为空，不读取已有值。保存失败保留草稿。设置写入携带开始编辑时读取的版本。品牌身份与连接名称独立。模型选择通过已有输入区目录展示。模型列表成功不代表推理测试成功；发送提示的测试需要费用提示和持久化请求记录。

<a id="default-composition"></a>
## 默认组合

dobee 自有 bundle 插入服务商及 UI 插件，通过组合覆盖修改默认模型配置，不修改上游插件代码。现有官方路由继续用于历史会话。初始默认值不发起网络请求，不静默选择其他付费服务商。Desktop 验证使用隔离的 Harness home 和 Electron 用户数据目录。

<a id="acceptance"></a>
## 验收

1. 编译 Host 和 Client 程序，验证有效及无效连接设置。
2. 验证原生和自定义协议的流式输出、工具参数、用量、取消、错误结束、回放、配置更新和卸载。
3. 通过真实 Loader 启动插件，确认 dobee 路由注册和模型发现。
4. 通过 UI 验证保存、重启恢复、多连接身份、默认选择和删除。
5. 带 dobee bundle 启动 Desktop，检查真实页面，并在有授权凭据时验证真实模型调用。
6. 缺失凭据、Copilot 授权、平台交互或 GUI 自动化时明确标为未验证；模拟服务不能证明真实服务商可用。

<a id="dev-note"></a>
## 开发备注

实现证据保存在测试和包文档中。Cherry Studio 的服务商行为用作参考，不复制其 AGPL 源码。云凭据链、任意 JSON 请求模板、自动跨服务商故障转移及输入区上下文窗口选择器不属于本次实现。
