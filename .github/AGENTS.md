# AGENTS.md — GitHub Actions

Upstream workflows in `workflows/` have no automatic triggers in dobee-work. Keep them disabled in GitHub repository settings and do not restore automatic triggers when opening PRs or synchronizing upstream. Design dobee-work CI separately rather than re-enabling upstream workflows.

The retained upstream definitions allow only `workflow_dispatch` and, for the reusable Python runtime builder, `workflow_call`. Event-specific job conditions remain unchanged; manual dispatch does not make PR-only or push-only jobs run. Run Windows jobs under native `pwsh` and preserve existing runner failover settings when maintaining these definitions.
