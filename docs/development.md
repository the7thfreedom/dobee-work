# Development guide

English | [中文](development.zh.md)

The setup tutorial takes a new contributor from prerequisites to a checked checkout. The contributor reference that follows covers repository layout, daily workflow, and CI organization. Design rationale and implementation details belong to the linked Agent Notes and scripts.

## Setup tutorial

### Prerequisites

- Node.js supports 22.19+ and 24+. CI covers 22.19, 24, and 26; see the [Node engine floor Agent Note](../.agents/notes/implemented/process/2026-07-06-node-engine-floor.md).
- Node.js TypeScript type stripping enabled. The repository build scripts load package declarations from TypeScript files, so they fail when `--no-experimental-strip-types` is in `NODE_OPTIONS` or the Node.js build lacks TypeScript support; `pnpm run build` checks this first and names the cause.
- Corepack-enabled pnpm. The repo pins `pnpm@11.7.0` in `package.json`; run `corepack enable` if `pnpm --version` does not resolve through Corepack.
- Git 2.26 or newer; hook setup enables Git's worktree-specific configuration extension.
- Optional: a DeepSeek API key for the Web, headless, and ACP automation demos and real-API e2e tests.

### Windows and WSL 2

On Windows, you can develop with native tools or use WSL 2 for a Linux environment. WSL 2 is useful for verifying Linux behavior and for using Linux toolchains when native dependency compilation or filesystem permissions obstruct Windows development. Each environment needs its own runtime, build tools, and permissions; WSL is optional.

Keep the checkout, installed dependencies, and toolchain in the same operating system environment. For WSL 2, store the checkout in the Linux filesystem; for native Windows tools, use the Windows filesystem. Accessing files across the two filesystems adds overhead to I/O-intensive operations such as Git, dependency installation, and builds. See Microsoft's [file storage and performance guidance](https://learn.microsoft.com/en-us/windows/wsl/filesystems#file-storage-and-performance-across-file-systems).

Install dependencies separately in each environment because native binaries and links can differ between operating systems. Test results apply to the environment where the tests ran; Windows-specific behavior still needs native Windows validation.

### First-time setup

pnpm uses its strict symlinked linker so undeclared dependencies fail instead of relying on hoisting. Keep dependency build scripts explicitly allowlisted in `pnpm-workspace.yaml`.

Install dependencies from the repo root:

```sh
pnpm install
```

The install also configures worktree-local Lefthook hooks through `scripts/install-lefthook.mjs`. The [worktree-local hooks Agent Note](../.agents/notes/implemented/process/2026-07-27-worktree-local-lefthook.md) owns the hook-path safety contract.

The [DevTools frontend](../packages/experimental/inspector/README.md#use-this-package) is compiled locally from a pinned npm source package and Vite. After dependencies are installed, its build needs no network access or browser installation. Workspace and published-package installation run no DevTools resource-download hook; published Inspector packages contain the built frontend.

If the hooks are missing because dependencies were restored from cache or `postinstall` was skipped, install them manually:

```sh
node scripts/install-lefthook.mjs
```

If the wrapper rejects existing Git configuration or reports a stale lock, follow its diagnostic and the linked Agent Note rather than editing worktree metadata speculatively. After moving a checkout, rerun the wrapper to regenerate the owned path.

Run typecheck once after a fresh clone:

```sh
pnpm run typecheck
```

Setup is complete when `pnpm run typecheck` exits successfully.

## Contributor reference

### TypeScript project layout

The repository uses isolated Host and Client aggregates. An ordinary package is registered in exactly one aggregate: Host packages in `tsconfig.host.json` and Client packages in `tsconfig.client.json`; three packages (`host/webserver`, `compaction/compaction`, `typert/registry`) are referenced by both aggregates as shared leaves so each side type-checks the same source.

| File | Role | Forms a program? |
|---|---|---|
| `tsconfig.json` | Solution root: `extends` base, `files: []`, and references to the two aggregates. It is the tsserver discovery entry and the entry for explicitly running the complete Project Reference graph; through the inherited `paths`, it is also the resolution config for tsx running `scripts/`. | No |
| `tsconfig.host.json` | Host aggregate: Host packages, examples, tests, scripts, website, and the exceptional Host project of `api/remotes`. | Yes |
| `tsconfig.client.json` | Client aggregate: `packages/client/*` packages and their tests, `apps/web`, and the exceptional Client project of `api/remotes`. | Yes |
| `tsconfig.base.json` | Shared compilerOptions and the source `paths` map. Also the resolution facade the vitest configs point vite-tsconfig-paths at: it has no `include`, so its `paths` apply to every importer. | No |
| `tsconfig.base.client.json` | Browser compiler settings (`jsx`, DOM libs, `types: []`) extended by the Client aggregate and every `packages/client/*` package. | No |

Host and Client stay two aggregate programs because both sides declaration-merge the cordis `Context` interface under the same keys with different services; one program seeing both merges reports a collision. The collision exists only inside a `ts.Program` — module resolution never triggers it — which is why the solution may reference both aggregates and one paths facade may span both sides. Three disciplines follow:

- `tsconfig.base.json` never gains `include` or `files`: they would leak into every extending package project and narrow the facade's match-all scope.
- A script that builds a repo-wide `ts.Program` seeds `tsconfig.host.json` or `tsconfig.client.json` explicitly — never the root solution, because flattening both aggregates into one program collides the `Context` merges.
- A new package is registered in exactly one aggregate; only the split packages above carry both leaf configs, and the shared leaves are registered in both aggregates because each side must type-check the same source. Having both a Node loader entry and a browser entry is not a reason to split a package; an ordinary Client plugin produces both runtime artifacts during the Client build phase.

Six packages split Host and Client tsconfigs: `api/remotes`, `api/gateway`, `api/session-controller`, `api/workspace-controller`, `client/connection`, and `session-query/session-log-export`. `api/remotes`' Host entry participates in the Host Typert graph while its Client entry imports generated `/remote` declarations; `session-log-export` keeps Node archive production out of its browser controller. Each split package-root `tsconfig.json` is therefore only a solution, and the two aggregates and direct consumers reference `tsconfig.host.json` or `tsconfig.client.json` respectively. The workspace `constraints` gate walks the reachable Project Reference graph and checks each referencing project's own compiler face: a single-config target remains valid from either face, while a split target must name the matching leaf rather than its solution root or opposite leaf; it discovers split packages from the presence of both leaf configs, so a new split joins the gate automatically. The [`api-remotes` README](../packages/api/remotes/README.md) and [`session-log-export` README](../packages/session-query/session-log-export/README.md) explain their splits.

The development build keeps Host and Client generation ordered:

```sh
tsc -b tsconfig.host.json --emitDeclarationOnly --noCheck
tsx scripts/dobee-vite-build.ts --face host
tsx scripts/dobee-vite-build.ts --face desktop
tsc -b tsconfig.client.json --emitDeclarationOnly --noCheck
tsx scripts/dobee-vite-build.ts --face client
pnpm run build:web
```

The dobee-owned [Vite workspace runner](../scripts/dobee-vite-build.ts) matches `vendor/*`, `packages/*/*`, and `apps/cli`; Host also builds `apps/desktop-host` and the native system JavaScript entry. It reads upstream `tsdown.config.ts` files as artifact declarations without invoking the tsdown bundler or changing upstream plugins. `DSH_BUILD_FACE` selects each package's Node and browser entries. Vite consumes their source files directly and preserves production/peer externals, separate plugin factories, lazy chunk names, stylesheet injection, workers, and asset copies. Main and Preload use the same runner; the Renderer shell and welcome page also use Vite.

`pnpm run build:desktop-runtime` builds the [Desktop dependency closure](../scripts/dobee-desktop-build-scope.ts) rooted at the application, private Host, bundled CLI, and Renderer. Selection includes workspace production, peer and optional dependencies, runtime source imports, profile bundles, bundle patch rows, and client module requests; conditional plugins remain included. Desktop declaration emission references selected compiler-face leaf projects instead of aggregate tests and scripts. Host declaration emission checks those projects once before Typert analyzes their already-checked types; Client declaration emission uses `--noCheck`. Missing workspace dependencies or bundle patches fail before emission. Plugin outputs remain independent, and external user-installed plugins stay outside this build. `pnpm run build` and release packaging retain the full workspace scope.

The [Desktop coordinator](../scripts/dobee-desktop-build.ts) computes the runtime selection once and sends it through stdin to serial, isolated Host, Desktop and Client builders. Each child exits before the next stage starts, releasing its compiler programs and Vite graphs while preserving reflection-before-Client ordering. The [Renderer cache](../scripts/dobee-renderer-build.ts) retains the package-owned Vite version and working directory, verifies physical module, worker and font inputs, and compares every output's content and the complete `dist/` roster before reuse. Corruption, missing files or unexpected outputs trigger Vite's clean Renderer rebuild.

Build output reports declaration time, concurrent Vite phase time, package/build counts, the five slowest package builds, and Typert time. Package times overlap and must not be summed as wall-clock time. Cold measurements remove compiler output, incremental state, and Renderer output while retaining installed dependencies; runtime preparation, application launch, installer generation, and dependency installation are separate operations.

Desktop builds reuse [verified Vite package artifacts](../scripts/dobee-vite-cache.ts) when package sources, observed bundled inputs, build implementations, dependency resolution, inherited environment, and every output file still match their recorded content hashes. Missing or changed outputs rebuild. Packages with nested build hooks or configuration-time filesystem reads bypass reuse because their complete input/output inventory is unavailable. Cache records live under `.dsh-build/dobee-vite/` and `pnpm run clean` removes them; environment values are represented only by a digest.

`pnpm run dev:desktop:watch` rebuilds after source edits using a 500 ms filesystem poll; `--watch-interval <milliseconds>` changes the positive poll interval. Client plugin edits use existing HMR, while Web-shell and welcome UI edits refresh pages without restarting Electron or Host. Main, Preload, Host and metadata changes restart the owned processes and interrupt running development tasks. Builds are serialized, edits received during a build remain queued, and a failed rebuild stops the application until another successful edit. Shutdown closes the watcher and settles owned process groups; see the [Desktop development commands](../apps/desktop/README.md#develop).

Watch startup records the [Host dependency baseline](../scripts/dobee-ui-build.ts). UI edits request `build:desktop-runtime --ui`, which skips native compilation, Host declarations and Typert only when the environment, Host-reachable sources, shared inputs and Node artifacts match that successful baseline. Type-only Host imports into UI directories remain Host inputs. Dynamic client-plugin edits also retain unchanged static Renderer and welcome artifacts; static UI edits rebuild those pages and request a page refresh. Added or removed UI files, changed shared inputs, missing artifacts or a missing baseline reject the shortcut and run a complete Desktop build; the watcher restarts Node processes when that fallback runs. `--record-ui-baseline` prepares this baseline explicitly without changing the ordinary Desktop build path.

Watch keeps [resident Vite compilers](../scripts/dobee-ui-resident.ts) for dynamic client plugins whose complete input inventories cover the edited files. Each compiler starts lazily and retains its own module graph; the compiler roster is bounded by the built plugin set. Successful source edits rebuild only the affected browser factories, without declaration emission or another package-manager process. Host guards run before and after compilation; a changed Host dependency or unsupported configuration returns to the ordinary build. Static UI and configuration-time filesystem hooks retain that path. The isolated compiler process and all watchers close before an ordinary build or development shutdown writes the same artifacts; `pnpm run typecheck` remains the explicit complete semantic check.

The UI guard scans repository inputs and installed dependency declarations afresh on every check, without repeatedly expanding overlapping file globs. It parses each UI package's manifest once per check and hashes current file contents before accepting the Host baseline; it does not trust cached modification times. Hashing reads each file directly instead of probing existence and file type again; missing files invalidate the digest, and other read failures stop the check explicitly. Resident build output reports the two guard phases and client-record hashing separately. Browser HMR can display newly written plugin artifacts before the queued guard and record work finishes, so build-completion time and visible-update time are separate measurements.

TypeScript emits declarations, not runtime JavaScript. `pnpm run build` and `pnpm run build:official` skip aggregate semantic checking; Typert still checks contributing Host projects before generating reflection and Remote artifacts. `pnpm run typecheck` checks both complete compiler faces, including tests and scripts. `pnpm run build:lib` retains complete semantic checking before Vite bundling. Host Typert generation precedes Client declarations and bundling so generated Remote imports remain available.

The dobee-owned [Host Typert cache](../scripts/dobee-typert-cache.ts) reuses generated artifacts only when SHA-256 hashes match for repository source and configuration, installed dependency declarations and manifests, generator dependencies, and every generated Typert file. Added, removed, or modified inputs and artifacts trigger generation. Declaration emission, decorator lowering, Vite bundles, and explicitly requested type checks still run. The cache lives in `.dsh-build/dobee-typert-cache.json`; `pnpm run clean` removes it, and a malformed record stops the build with a recovery error.

`pnpm run build` embeds the root package version, the seven-character source commit, and a dirty marker when Git reports local changes; it also inherits other caller-supplied `DSH_CLIENT_*` values. `pnpm run build:official` is the cross-platform local equivalent of the CI and release artifact build and omits the local dirty marker. Each successful complete build writes a gitignored record that binds the exact public values to the Vite output and dynamic client bundles; release packing and built Web tests reject a missing record or artifacts changed by a later partial build. `pnpm run dev:web` runs that complete build first (`--skip-build` reuses an existing artifact tree instead), then samples the current version and Git state once and shares that environment across every watcher stage for the session; it does not validate the complete-build record because the watcher stages rewrite its recorded artifacts.

Static analysis and tests resolve workspace imports through the base `paths` map to `src` and must pass on a clean tree; gates that consume built `lib/` output declare that dependency explicitly. Generated Host-for-Client Remote declarations are the deliberate exception: the public `typecheck`, `lint`, and `doc-typecheck` commands generate them first, while internal `*:contracts-ready` scripts assume that an invoking public command or scheduler gate already depends on the Typert contract-generation pass or the complete build. See the [Typert Remote note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md) for the gate-preparation contract.

Business services declare callable methods on the Host with `@Remote` or `@RemoteScope`; the Host build generates Host-for-Client types and runtime contributions, and the Client's `api-remotes` composition loads those contributions under `ctx.remote` and scoped `agentCtx.remote` namespaces. See [API Gateway](api-gateway.md) for the generated artifacts on both sides, their assembly relationships, the SRC development fallback, and the Web build order.

If a relevant local check consumes built package output, build once first:

```sh
pnpm run build
```

`pnpm run hygiene` includes `publint`, which validates package entrypoints against the built `lib/*.js` files, and `verify-node-next-types`, which validates built declarations against a temporary NodeNext consumer. A fresh worktree has no bundled JS or declarations until `pnpm run build` runs; ordinary commits and pushes do not require that build unless their selected checks consume it.

### Environment variables

The real DeepSeek adapter and key-backed agent demos read credentials from the environment or from a gitignored `.env` at the repo root:

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://... # optional
```

`DEEPSEEK_BASE_URL` is optional and defaults to the public API. Never commit real credentials. The real-API e2e suites self-skip when `DEEPSEEK_API_KEY` is not set.

### Git integrations

`.i18n.yaml` records use Git's default text merge. A record conflicts only when both branches changed language-specific content in the same heading section; resolve the Markdown, then rerun `pnpm run verify-translation-pairing --write <pair>`. If `pre-merge-commit` rejects an otherwise clean merge, Git leaves the complete result staged without a commit; repair the failure and run `git commit`, or run `git merge --abort`.

lefthook is configured in `lefthook.yml` as a fast local checkpoint:

- `pre-commit` verifies staged pairing records against the staged owner blobs, validates staged files with the project-free `.oxlintrc.staged.json` profile and applies Oxlint fixes with one bounded retry, regenerates `THIRD_PARTY_NOTICES.md` when a staged file is one of its inputs, checks the staged diff for whitespace errors, and runs the vendor manifest guard.
- `pre-merge-commit` performs the same index-backed pairing check before Git creates an automatic merge commit.
- `pre-push` runs `pnpm run typecheck`, which completes the Host lib phase, including generated Typert contracts, before the Client TypeScript check.

The vendor manifest guard checks that changes under `vendor/*/src` are staged with the matching `vendor/README.md` manifest update. See `vendor/README.md` before editing vendored code.

Apart from the scoped staged-record verification, the hooks intentionally do not run tests, snapshots, documentation checks, builds, or hygiene. Contributors run the [checks relevant to the changed behavior](../AGENTS.md#run-relevant-checks-locally) once; CI owns exhaustive coverage, built-artifact smokes, and the Node 22.19, 24, and 26 compatibility matrix.

Contributors can opt into the comprehensive local gate set with `pnpm run check:all`. The command is independent of the Git hooks and is not an agent instruction.

### CI gates

The keyless [CI workflow](../.github/workflows/ci.yml) groups independent gates into broad lanes and runs a smaller compatibility signal across supported Node versions. Artifact consumers wait for one build within their lane. Required benchmarks run separately on standard GitHub-hosted Linux; the [benchmark runner reference](../benchmarks/AGENTS.md) owns routing and the job timeout. The separate real-API workflow runs `pnpm run test:e2e` with its configured worker bound. See [scripts/run-gates.ts](../scripts/run-gates.ts) and the workflow files for the current gate and job inventory.

The credential-free dsh dependency-layout and dsh/vendor pack rehearsals use the existing Linux self-hosted pool only when `DSH_CI_FAILOVER_LINUX=selfhosted` and the event is a trusted master push or same-repository, non-fork, non-Dependabot pull request. All other cases, including manual dispatch, use `ubuntu-24.04`; manual publication stays hosted. See the [release rehearsal runner reference](../.agents/notes/implemented/process/2026-07-26-ci-failover-runbook.md) for persistent-store isolation and fallback limits.

### Daily commands

The root [contributor instructions](../AGENTS.md#commands) summarize common commands, while [`package.json`](../package.json) and [scripts/run-gates.ts](../scripts/run-gates.ts) own the current script and gate inventories. Select the smallest checks that cover the changed surface. Documentation changes use `pnpm run doc-sync`; package-public behavior changes also update the owning README or JSDoc, and built-artifact checks require `pnpm run build` first.

### Profile runs

Run the repository build separately before using these source-checkout demos:

```sh
pnpm run build
```

The one-shot Headless coding agent needs `DEEPSEEK_API_KEY` in the environment or repo-root `.env`:

```sh
pnpm dsh --profile headless "summarize this workspace"
```

The PTC mode demo runs the same headless profile with code presentation enabled:

```sh
pnpm run demo:ptc -- "summarize this workspace"
```

<a id="application-commands"></a>

### Application commands

Choose the build scope before launching: `pnpm run build` prepares the complete workspace for Web and release consumers; `pnpm run build:desktop-runtime` prepares only the Desktop runtime dependency closure. `start:*` reuses existing artifacts. `dev:web` builds the complete workspace and watches client bundles; `dev:desktop` builds the Desktop runtime once, while `dev:desktop:watch` also rebuilds on edits:

```sh
pnpm run start:web       # serve built Web artifacts through the source launcher (the same launch as pnpm dsh web)
pnpm run dev:web         # build, serve, and rebuild Web client bundles on source edits
pnpm run start:desktop   # launch built Desktop artifacts
pnpm run dev:desktop     # build Desktop runtime, then launch
pnpm run dev:desktop:watch # build, launch, and watch Desktop sources
```

Desktop UI contributors normally use `pnpm run dev:desktop:watch`; Host/Main/Preload changes restart the application and interrupt tasks. Use `pnpm run typecheck` for the complete semantic check; a successful runtime build does not replace it. To recover from suspect cached artifacts, stop the watcher, run `pnpm run clean`, and rebuild the selected scope. See [build ordering and cache validation](#typescript-project-layout).

Arguments after a Web command reach `dsh web`, for example `pnpm run dev:web --no-open --port 3081`; `dev:web` also accepts `--skip-build` to reuse the existing artifact tree and `--no-serve` to run only the rebuild watchers beside a server started elsewhere. Both Web commands use the normal Harness home, while the Desktop commands use the isolated development home described in the [Desktop README](../apps/desktop/README.md). The root `Makefile` exposes the same commands, including `make build-desktop` and `make dev-desktop-watch`; `ARGS` forwards options, such as `make dev-desktop-watch ARGS='--watch-interval 1000'`.

dobee-work keeps build adapters in `scripts/dobee-*` and product customizations in independent `dobee` plugins. Upstream synchronization must preserve both the owned files and their shared entrypoint wiring; follow the [synchronization guard procedure](cookbook/syncing-dobee-upstream.md#customization-protection) rather than replacing local files with upstream versions.

### TODO markers

Use one of three comment tags to flag known issues in the code, ordered by urgency:

- `FIXME` — an issue that should block a new release. A release should not ship with an open `FIXME` unless reviewers explicitly agree the change can be merged anyway.
- `TODO` — an issue that should be fixed soon, once we have the resources.
- `XXX` — an issue that we may fix someday; lowest priority, no commitment.

Pick the tag that matches the urgency so anyone scanning the code can tell a release blocker from a someday-maybe.

### Documenting types verbatim (`ts type-equiv`)

The [subsystems](subsystems/README.md) pages paste source-equivalent declarations together with their original JSDoc so a reader sees the exact type definition and source contract. To keep a paste from drifting when source changes, fence it as ` ```ts type-equiv ` (instead of ` ```ts `) and register it in `scripts/type-equiv.manifest.json` with the source file and symbol it mirrors:

```json
{ "doc": "docs/subsystems/session.md", "symbol": "SessionEvent", "source": "packages/core/session/src/types.ts" }
```

`pnpm run verify-type-equiv` (part of `doc-sync`) then extracts that symbol's declaration and attached JSDoc from source via the TypeScript parser and asserts the block matches both. For a class whose implementation bodies do not belong in the catalog, use ` ```ts public-api ` and set `"projection": "public-api"`; the checked projection retains the public fields, constructor, accessors, methods, and original class/member JSDoc while omitting bodies and private or protected members. Comparison ignores whitespace and non-JSDoc comments but requires every original JSDoc comment, including member documentation, so readers see the source contract beside the exact type definition. The gate enforces a 1:1 correspondence by document, symbol, and projection between primary blocks and manifest entries; a paired `.zh.md` block reuses its unsuffixed sibling's entry only when the whole tracked fence sequence is byte-identical and ordered identically. `doc-typecheck` applies the same derivative rule to compilable fences, while skipping both source-equivalence fence kinds from compilation and its opt-out ratio. When you change a documented declaration or its JSDoc, the gate fails until you update the paste; when you add or remove a primary block, update the manifest in the same change.
