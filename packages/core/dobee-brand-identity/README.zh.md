---
description: "在 harness 所属系统提示词中标识 DobeeWork，同时保留完整提示词与部署 persona。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dobee-brand-identity

[English](README.md) | 中文

## 概述

使用本包可在模型提示词中标识 DobeeWork，不改变部署 persona，也不引入浏览器依赖。省略 harness 身份的 profile 与显式完整提示词保持不变。它不添加工具或运行时上下文。

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

共享 base bundle 在 Web、桌面、headless、SDK 及 ACP profile 中挂载本插件。

```yaml
- name: '@deepseek-ai/dsh-dobee-brand-identity'
```

本插件没有配置字段。现有 system-prompt 配置仍决定是否包含 harness 身份。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

协作式提示词装配 waterfall 仅替换 `harness:identity` 中的上游默认文字；自定义作用域身份保持不变。完整提示词恢复仍由注册表负责。渲染与 Session 日志仍由现有机制负责，因此修改后的文字通过正常系统消息路径记录。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [System prompt](../system-prompt/README.zh.md) — 装配与完整提示词语义。
- [Base bundle](../../bundle/base/README.zh.md) — 共享 profile 组合。
- [浏览器品牌](../../client/dobee-brand/README.zh.md) — 独立 UI 展示。

-----

<a id="model-experience"></a>
## Model Experience

### System prompt identity

#### What the model sees

模型在部署 persona 之前接收以下固定开场白，除非组合省略该段或提供完整提示词。

##### Harness identity

```markdown
You are an AI agent powered by DobeeWork.
```

#### Token effect

固定身份段替换上游身份文字。省略 harness 身份或完整提示词优先时，它不贡献任何内容。

#### KV Cache effect

身份变化影响系统提示词开头的前缀。现有 Session 通过正常提示词更新规则协调变化；不保证提供商缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **保留现有文字归属** — 显式完整提示词与其他插件的 persona 文字保留原始文案。本插件不改写历史 Session 数据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
