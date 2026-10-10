# 手动同步 dobee-work 上游代码

[English](syncing-dobee-upstream.md) | 中文

## 摘要

维护者通过普通 Git merge 将 deepseek-harness 更新合入 dobee-work，保留本地修改和上游祖先关系。同步由人工触发：不配置定时任务、自动冲突解决或自动发布。本流程默认同步上游 `master`；维护者也可明确选择已获取的发布 tag。

## 目录

- [仓库配置](#repository-setup)
- [手动同步](#manual-synchronization)
- [定制保护](#customization-protection)
- [冲突与恢复](#conflicts-and-recovery)
- [合入与确认](#landing-and-verification)
- [开发备注](#dev-note)

<a id="repository-setup"></a>

## 仓库配置

`origin` 指向 `the7thfreedom/dobee-work`，`upstream` 指向 `deepseek-ai/deepseek-harness`。remote 配置属于本地 Git 配置，不是受版本控制的文件。每次新 clone 后，先检查 `git remote -v`，仅在 remote 不存在时添加：

```bash
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream master
```

标题为 `Connect deepseek-harness upstream history` 的提交将 dobee-work 的快照历史与上游 `0.2.1-alpha.1` 历史连接起来。两个父提交及该 merge commit 的文件树完全相同。这次一次性衔接使用 `--allow-unrelated-histories`；日常同步不得使用该选项或 `ours` 合并策略。

首次日常同步前，需要将已衔接的历史发布到 dobee-work 的 `main`。如果 `origin` 仍没有 `main`，维护者可明确授权从已完成分支执行 `git push origin HEAD:main`。否则，通过保留 merge commit 的 PR（Pull Request）合入。不要 force-push，也不要替换已有远端分支。本文档本身不构成发布授权。

<a id="manual-synchronization"></a>

## 手动同步

开始前，工作区必须干净，且已发布的 `origin/main` 必须包含衔接后的历史。先完成或单独提交本地工作。在仓库根目录运行命令；应用管理的 worktree 必须通过应用的新会话分支机制操作，不得使用下面的切换分支命令。

1. 获取两个仓库的更新，从 dobee-work 的 `main` 创建专用分支，并固定上游目标。将示例分支后缀替换为唯一标识。如果 fetch 失败，停止流程，不得使用旧缓存引用继续合并。

```bash
git fetch origin
git fetch upstream master
git switch -c sync/upstream-YYYYMMDD origin/main
dobee_base=$(git rev-parse HEAD)
upstream_commit=$(git rev-parse upstream/master)
git show -s --format='%H %s' "$upstream_commit"
git show "$upstream_commit:package.json"
git merge-base HEAD "$upstream_commit"
```

如果不存在共同祖先，停止并检查历史衔接，不要重复导入无关历史。若按发布版本更新，应明确从 upstream 获取所选 tag，并将其提交赋给 `upstream_commit`。在同步提交和 PR 中记录对应的包版本号及完整 SHA。

2. 检查目标是否已包含在当前历史中。退出码 0 表示无需合并；退出码 1 表示目标不是当前提交的祖先；其他错误需要排查。

```bash
git merge-base --is-ancestor "$upstream_commit" HEAD
```

3. 如果尚未包含目标，合并但暂不提交：

```bash
git merge --no-ff --no-commit "$upstream_commit"
```

4. 逐项解决冲突，暂存已解决的文件，并以 `dobee_base` 为基线运行[定制检查](#customization-protection)，即使 Git 未报告冲突也必须执行。然后按 [dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md) 选择覆盖实际更新的检查。如果依赖声明有变动，使用固定版本的包管理器及冻结锁文件安装依赖。如果有包被删除或重命名，构建前先运行 `pnpm run clean`，移除过期的生成产物。针对 dobee-work 定制和上游破坏性变更运行相关测试，参考[测试指南](../testing.zh.md)和对应版本的升级指南。无法执行的检查必须明确标为未验证。

5. 审阅暂存差异并提交合并。标题可使用 `Merge deepseek-harness <version>`，正文包含 `Source: deepseek-ai/deepseek-harness@<full SHA>` 及要求的共同作者尾注。尽可能将后续本地修复单独提交；冲突解决属于合并提交。

```bash
git diff --cached --stat
git diff --cached --check
pnpm run verify:dobee-customizations --base "$dobee_base" --upstream "$upstream_commit" --cached
git commit
git merge-base --is-ancestor "$upstream_commit" HEAD
```

<a id="customization-protection"></a>

## 定制保护

[dobee 定制检查器](../../scripts/dobee-customizations.ts) 从**同步前的提交**中发现路径组件以 `dobee` 开头的受跟踪文件，以及引用 `dobee` 或 `Dobee` 的文本文件，排除 vendor 代码和已归档 Agent Notes。`--upstream` 还会保护相对传入上游提交的共同祖先发生过本地变更的每个文件，包括 CI 开关等没有命名标记的定制。这覆盖独立插件、构建适配器、测试、文档、共享 manifest、profile 和启动器接入，无需维护另一份文件清单。在合并结果中删除引用，不能将文件移出受保护集合。

提交前对已暂存的合并结果执行：

```bash
pnpm run verify:dobee-customizations --base "$dobee_base" --upstream "$upstream_commit" --cached
```

受保护文件发生变化就会检查失败，包括 Git 自动合并成功的变化。受保护文件被删除或存在未解决冲突时一律失败。保留本地实现；若需进行兼容上游的适配，先审阅该文件相对 `dobee_base` 的完整差异，运行其行为测试，再用重复的 `--reviewed <path>` 参数逐一确认准确路径。确认只允许已审阅的内容变更，不允许删除；无对应变化的路径或 glob 会失败。在同步 PR 中记录已审阅路径、理由和测试结果。检查器只能检测变化，不能证明行为等价。

例如，审阅适配后的根 manifest 后：

```bash
pnpm run verify:dobee-customizations --base "$dobee_base" --upstream "$upstream_commit" --cached --reviewed package.json
DOBEE_SYNC_REVIEWED='["package.json"]' git commit
```

当 `MERGE_HEAD` 可从已获取的 `refs/remotes/upstream/*` 引用到达时，本地 `pre-commit` 和 `pre-merge-commit` hook 自动检查暂存结果。它们以合并前的 `HEAD` 为基线、`MERGE_HEAD` 为上游目标，并通过 JSON 数组环境变量 `DOBEE_SYNC_REVIEWED` 接收准确的已审阅路径。通过正常依赖安装流程安装 hook，不得跳过。远端合并、绕过 hook 的合并，以及不在已获取上游引用中的发布 tag，仍须执行上述显式命令。PowerShell 用户需为该提交设置 `$env:DOBEE_SYNC_REVIEWED`，随后移除。

构建优化代码保留在 `scripts/dobee-*`，产品行为保留在独立的 `dobee` 插件中，不得移植进上游插件。共享入口在吸收兼容上游变更时，必须保留 Vite 构建脚本、Desktop 运行时范围、watch 启动器、插件注册及 profile/依赖声明。不要添加全局 `ours` 合并属性，它会隐藏传入修复而非审阅适配。构建范围和缓存恢复请遵循[本地开发指南](../development.zh.md#application-commands)。

<a id="conflicts-and-recovery"></a>

## 冲突与恢复

使用 `git status` 查找冲突。在接纳上游变更时保留 dobee-work 的行为，不要无差别采用某一侧的所有文件。双语文档必须一起解决冲突，并重新生成配对记录。如果合并仍在进行且无法安全解决，`git merge --abort` 可返回合并前的干净状态。不要中止无关工作，也不要丢弃原本未提交的工作区内容。

如果提交后检查失败，应先在同步分支修复，再发布。不要重写共享历史。普通 merge revert 会保留上游祖先关系，因此再次合并同一目标不会恢复已撤销的内容；恢复时需明确撤销该 revert 或创建修复提交。

<a id="landing-and-verification"></a>

## 合入与确认

仅在得到授权并完成所需检查后发布，然后向 dobee-work 的 `main` 创建 PR。说明此前及所选的上游版本、完整目标 SHA、本地冲突解决、破坏性变更和准确的检查结果。只向 `origin` 推送，不向 `upstream` 推送。

**同步 PR 必须用 merge commit 合入，不得 squash 或 rebase merge。** Squash 或 rebase 会丢弃后续合并需要的上游父提交关系。本地功能改动应与上游同步分开。

合入后，获取 `origin`，并确认固定的目标提交是已发布主分支的祖先：

```bash
git fetch origin
git merge-base --is-ancestor "$upstream_commit" origin/main
pnpm run verify:dobee-customizations --base "$dobee_base" --upstream "$upstream_commit"
```

在已发布主分支的干净检出中执行最终定制检查，只重复 PR 中准确的已审阅路径。祖先关系和定制检查均返回退出码 0 才表示成功。只有首次连接未经修改的快照时才要求文件树与上游相同；已定制的 dobee-work 分支不需要与上游文件树相同。

<a id="dev-note"></a>

## 开发备注

无。
