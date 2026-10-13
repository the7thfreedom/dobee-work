---
kind: upgrade-guide
description: "Dobee Desktop 的初始默认模型使用独立模型服务商 bundle 和凭据引用。"
---

# Dobee Desktop 默认模型服务商

[English](guide.md) | 中文

## 变更

Dobee Desktop 在上游 Web bundle 之外加载 dobee 模型 bundle。bundle 层初始默认值从 `deepseek-official/deepseek-flash` 改为 `dobee-deepseek/deepseek-flash`。dobee 连接使用 `DOBEE_DEEPSEEK_API_KEY`，不是上游凭据引用。bundle 禁用 `ui-settings-models`、`llm-deepseek`、`llm-deepseek-account` 和 `llm-pi-ai`；dobee 设置页名为**模型**。聊天模型选择器仍可使用，仅提供 dobee 路由。上游模型路由不再可用，包括已有会话或显式 profile 默认值中保存的路由。

## 迁移

1. 使用原生欢迎页的稍后配置操作，然后打开**设置 → 模型**，为 DeepSeek 连接配置凭据，或创建其他连接并选择默认模型。原生表单仍配置官方服务商，不写入 `DOBEE_DEEPSEEK_API_KEY`。
2. 将 Desktop profile 的 `cordis.patch.yml` 中任何上游 `agent-default-model` 选择替换为已配置的 dobee 路由，例如 `provider: dobee-deepseek` 和 `model: deepseek-flash`。继续每个已有会话前，先选择已配置的 dobee 模型；会话历史保留，不自动改写路由。
3. 确认输入区仅列出 dobee 服务商，初始连接只显示一组 DeepSeek 模型。使用已获授权的密钥验证请求；仅配置密钥不代表推理可用。
