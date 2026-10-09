---
kind: upgrade-guide
description: "Dobee Desktop 的初始默认模型使用独立模型服务商 bundle 和凭据引用。"
---

# Dobee Desktop 默认模型服务商

[English](guide.md) | 中文

## 变更

Dobee Desktop 在上游 Web bundle 之外加载 dobee 模型 bundle。bundle 层初始默认值从 `deepseek-official/deepseek-flash` 改为 `dobee-deepseek/deepseek-flash`。dobee 连接使用 `DOBEE_DEEPSEEK_API_KEY`，不是上游凭据引用。显式 profile 设置仍覆盖 bundle 默认值。现有会话路由和官方适配器继续保留。

## 迁移

1. 打开 dobee 模型设置页，为 DeepSeek 连接配置凭据，或创建其他连接并选择默认模型。
2. 如需保留官方路由，在 Desktop profile 的 `cordis.patch.yml` 中保留或设置 `agent-default-model` 为 `provider: deepseek-official` 和 `model: deepseek-flash`。
3. 创建会话并确认输入区显示预期服务商和模型。使用已获授权的密钥验证请求；仅配置密钥不代表推理可用。
