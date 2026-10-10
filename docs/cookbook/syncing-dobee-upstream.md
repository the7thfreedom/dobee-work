# Manually synchronizing dobee-work with upstream

English | [中文](syncing-dobee-upstream.zh.md)

## Summary

Maintainers update dobee-work from deepseek-harness through ordinary Git merges, preserving local changes and upstream ancestry. Synchronization is manual: no schedule, automatic conflict resolution, or automatic publication is configured. This procedure targets upstream `master`; a maintainer may deliberately select a fetched release tag instead.

## Table of Contents

- [Repository setup](#repository-setup)
- [Manual synchronization](#manual-synchronization)
- [Customization protection](#customization-protection)
- [Conflicts and recovery](#conflicts-and-recovery)
- [Landing and verification](#landing-and-verification)
- [Dev Note](#dev-note)

<a id="repository-setup"></a>

## Repository setup

`origin` identifies `the7thfreedom/dobee-work`; `upstream` identifies `deepseek-ai/deepseek-harness`. Remote configuration is local Git configuration, not a tracked file. In each new clone, inspect `git remote -v` and add the remote only if it is absent:

```bash
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream master
```

The commit titled `Connect deepseek-harness upstream history` joins the dobee-work snapshot history to the upstream `0.2.1-alpha.1` history. Its two parents and the merge commit have identical file trees. This one-time connection uses `--allow-unrelated-histories`; routine synchronization must not use that option or the `ours` merge strategy.

Before the first routine synchronization, publish the connected history to dobee-work `main`. If `origin` still has no `main`, a maintainer may explicitly authorize `git push origin HEAD:main` from the completed branch. Otherwise, land the branch through a merge-commit PR. Do not force-push or replace an existing remote branch. This guide does not authorize publication.

<a id="manual-synchronization"></a>

## Manual synchronization

Start with a clean worktree and a published `origin/main` containing the connected history. Finish or separately commit local work first. Run commands from the repository root; application-managed worktrees must use the application's new-session branch mechanism instead of switching branches with the command below.

1. Fetch both repositories, create a dedicated branch from dobee-work `main`, and pin the upstream target. Replace the example branch suffix with a unique identifier. A failed fetch stops the procedure; do not merge an old cached ref.

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

If no merge base exists, stop and inspect the history connection rather than repeating the unrelated-history import. For a release update, explicitly fetch the selected tag from upstream and assign its commit to `upstream_commit` instead. Record its package version and full SHA in the synchronization commit and PR.

2. Check whether the target is already included. Exit status 0 means there is nothing to merge; status 1 means the target is not an ancestor; any other error requires investigation.

```bash
git merge-base --is-ancestor "$upstream_commit" HEAD
```

3. If the target is not included, merge it without committing immediately:

```bash
git merge --no-ff --no-commit "$upstream_commit"
```

4. Resolve conflicts deliberately, stage the resolved files, and run the [customization guard](#customization-protection) against `dobee_base`, even when Git reports no conflicts. Then follow [dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md) for checks covering the actual update. Install dependencies with the pinned package manager and frozen lockfile if dependency manifests changed. When packages are removed or renamed, run `pnpm run clean` before building to remove obsolete generated outputs. Include focused tests for dobee-work customizations and upstream breaking changes; use [testing guidance](../testing.md) and the release's upgrade guides. Unavailable checks must remain explicitly unverified.

5. Review the staged diff and commit the merge. Use a title such as `Merge deepseek-harness <version>`, a body containing `Source: deepseek-ai/deepseek-harness@<full SHA>`, and the required co-author trailer. Keep follow-up local fixes separate when possible; conflict resolutions belong in the merge.

```bash
git diff --cached --stat
git diff --cached --check
pnpm run verify:dobee-customizations --base "$dobee_base" --upstream "$upstream_commit" --cached
git commit
git merge-base --is-ancestor "$upstream_commit" HEAD
```

<a id="customization-protection"></a>

## Customization protection

The [dobee customization guard](../../scripts/dobee-customizations.ts) discovers tracked paths with a `dobee`-prefixed component and text files referring to `dobee` or `Dobee` in the **pre-sync commit**, excluding vendored code and archived Agent Notes. `--upstream` also protects every local file changed since the common ancestor with the incoming upstream commit, including unmarked customizations such as CI switches. This covers independent plugins, build adapters, tests, documentation, shared manifests, profiles, and launcher wiring without maintaining a second file inventory. Removing references in the merge result cannot remove a file from the protected set.

Run it on the staged merge before committing:

```bash
pnpm run verify:dobee-customizations --base "$dobee_base" --upstream "$upstream_commit" --cached
```

Changed protected files fail the check, including clean Git merges. Deleted protected files and unresolved conflicts always fail. Preserve the local implementation; for an upstream-compatible adaptation, inspect that file's complete diff against `dobee_base`, run its behavior tests, and acknowledge only its exact path with repeated `--reviewed <path>` arguments. An acknowledgement permits a reviewed content change, not a deletion, and unused paths or globs fail. Record the reviewed paths, rationale, and test results in the synchronization PR. The guard detects changes; it does not establish behavioral equivalence.

For example, after reviewing an adapted root manifest:

```bash
pnpm run verify:dobee-customizations --base "$dobee_base" --upstream "$upstream_commit" --cached --reviewed package.json
DOBEE_SYNC_REVIEWED='["package.json"]' git commit
```

Local `pre-commit` and `pre-merge-commit` hooks run the staged guard automatically when `MERGE_HEAD` is reachable from a fetched `refs/remotes/upstream/*` ref. They use `HEAD` as the pre-merge baseline and `MERGE_HEAD` as the upstream target, and accept exact reviewed paths through the JSON-array environment variable `DOBEE_SYNC_REVIEWED`. Install hooks through the normal dependency setup; do not skip them. Remote merges, bypassed hooks, and release tags outside the fetched upstream refs still require the explicit command above. PowerShell users set `$env:DOBEE_SYNC_REVIEWED` for the commit and remove it afterward.

Keep build optimization code in `scripts/dobee-*` and product behavior in independent `dobee` plugins; do not transplant it into upstream plugins. Shared entrypoints must retain the Vite build scripts, Desktop runtime scope, watch launcher, plugin registrations, and profile/dependency declarations while incorporating compatible upstream changes. Do not add blanket `ours` merge attributes: they hide incoming fixes instead of reviewing adaptations. Follow the [local development guide](../development.md#application-commands) for build scope and cache recovery.

<a id="conflicts-and-recovery"></a>

## Conflicts and recovery

Use `git status` to find conflicts. Preserve dobee-work behavior while adopting upstream changes; never accept every file from one side blindly. Resolve bilingual documentation together and regenerate its pairing record. If a merge remains in progress and cannot be resolved safely, `git merge --abort` returns to the clean pre-merge state. Do not abort unrelated work or discard an existing dirty worktree.

If checks fail after committing, fix the problem on the synchronization branch before publication. Do not rewrite shared history. A normal merge revert leaves upstream ancestry intact, so merging the same target again does not restore the reverted content; restoring it requires an explicit revert-of-revert or a corrective commit.

<a id="landing-and-verification"></a>

## Landing and verification

Publish only after authorization and the required checks, then open a PR against dobee-work `main`. Include the previous and selected upstream versions, full target SHA, local conflict resolutions, breaking changes, and exact check results. Push only to `origin`, never to `upstream`.

**Land synchronization PRs with a merge commit, not squash or rebase merge.** Squashing or rebasing discards the upstream parent relationship needed by subsequent merges. Keep local feature changes separate from upstream synchronization.

After landing, fetch `origin` and verify the pinned target is an ancestor of the published main branch:

```bash
git fetch origin
git merge-base --is-ancestor "$upstream_commit" origin/main
pnpm run verify:dobee-customizations --base "$dobee_base" --upstream "$upstream_commit"
```

Run the final guard in a clean checkout of the published main branch, repeating only the exact reviewed paths from the PR. Success means exit status 0 for both ancestry and customization checks. Tree equality with upstream is required only for the initial unmodified snapshot connection, not for a customized dobee-work branch.

<a id="dev-note"></a>

## Dev Note

None.
