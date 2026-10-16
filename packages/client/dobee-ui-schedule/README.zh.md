---
description: "先引导填写任务内容和执行时间，再打开带有未发送草稿的会话来创建自动化任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-dobee-ui-schedule

[English](README.md) | 中文

## 概述

通过有引导的对话创建自动化任务，而不是直接打开一个不知用途的空白聊天。先填写要做什么、什么时候执行，再检查并发送准备好的请求。引导明确区分草稿准备与任务创建成功，并说明在哪里管理创建结果。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web 组合为 Web 和桌面端挂载本插件。本插件没有配置字段。

目录的两个创建入口都显示“通过对话创建”，并打开相同的引导。任务内容和执行时间为必填项；仅有空白字符时无法继续。示例展示任务指令与重复时间，并提示需要时注明时区。取消、Escape、关闭按钮或点击外部都会收起引导，不会打开会话。

“前往会话确认”通过现有工作区导航准备本地化的未发送请求，并保留会话已有草稿。用户必须检查并发送消息；此操作不会创建定时任务，也不会报告创建成功。引导说明助手可能确认细节、任务卡片代表创建成功，以及可在“自动化任务”查看、修改和删除任务。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

插件填充共享目录的 `schedule.manager.creation` 槽位，覆盖页头与空状态两处入口。每个入口拥有本地表单状态。工作区导航初始化草稿而不清除已有内容；定时执行、持久化和创建结果卡片仍由原有模块负责。移除本插件后，目录恢复默认创建操作。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [任务目录](../ui-schedule/README.zh.md) — 查看与管理任务。
- [工作区](../ui-workspace/README.zh.md) — 会话导航与草稿初始化。
- [Schedule](../../schedule/schedule/README.zh.md) — 持久化与投递。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本插件只准备可编辑草稿而不发送；面向模型的输入由常规会话提交负责。

#### KV Cache 影响

用户将草稿作为普通消息发送之前没有影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 创建依赖带有定时任务工具的助手；此引导不是直接创建定时任务的表单。
- 执行时间为自由文本，由助手解释或确认，不代表已通过定时规则校验。
- 入口保持挂载时，关闭引导会保留字段；离开页面或刷新后不持久保留。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
