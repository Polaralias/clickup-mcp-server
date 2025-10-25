# ClickUp-MCP Operations Runbook

This runbook distils the operational handbook into actionable routines for daily execution, incident handling, and ongoing stewardship. Use it alongside `HANDBOOK.md` for deeper context.

## 1. Daily Routine

| Task | Command or Action | Expected Outcome |
| --- | --- | --- |
| Dependency status | `npm outdated` | Capture pending upgrades for weekly triage. |
| Health probe | Invoke the `health` MCP tool | `status: ok` with recent timestamp. |
| Log rotation check | Verify stderr sink or collector | Confirm disk quotas and retention targets. |
| Rate-limit guard | Inspect metrics/logs for `LIMIT_EXCEEDED` | No sustained spikes above baseline. |

## 2. Pre-Deployment Checklist

1. Review change scope and ensure corresponding handbook sections are updated.
2. Run `npm run lint`, `npm run typecheck`, and `npm test` locally.
3. Execute `npm run build` and validate artefacts in a staging environment.
4. Confirm environment variables match the configuration table in `HANDBOOK.md`.
5. Schedule a post-deploy verification window to run smoke tests via MCP tools.

## 3. Incident Response

### 3.1 First Response Steps

1. Identify impacted tools and capture recent stderr logs with timestamps and log levels.
2. Reproduce the issue in staging using the same tool payload.
3. Check for `INVALID_PARAMETER`, `LIMIT_EXCEEDED`, or `CLICKUP_ERROR` codes to classify the failure.
4. Apply mitigations: reduce concurrency, roll back recent deployments, or rotate credentials as required.

### 3.2 Escalation Criteria

* More than three consecutive `CLICKUP_ERROR` responses for a critical tool.
* Any data mutation observed without prior `dryRun` confirmation.
* Sustained latency breaches exceeding configured `CLICKUP_TIMEOUT_MS`.
* Repeated truncations that block downstream reasoning even after pagination attempts.

Document every incident summary back into the handbook’s troubleshooting section once resolved.

## 4. Maintenance Windows

1. Announce downtime and freeze mutating MCP actions.
2. Deploy dependency or schema upgrades following the workflow in Section 6 of `HANDBOOK.md`.
3. Execute full regression tests (`npm test`) and targeted tool verification via MCP client scripts.
4. Resume normal operations only after `health` checks and sample tool invocations succeed without warnings.

## 5. Upgrade Playbook

| Scenario | Actions |
| --- | --- |
| ClickUp API deprecation | Audit affected gateways in `src/infrastructure/clickup/`, update schemas, adjust usecases, and expand tests before rollout. |
| Node.js runtime upgrade | Validate compatibility locally, rebuild artefacts, and monitor for runtime warnings post-deploy. |
| Feature flag activation (`FEATURE_PERSISTENCE`) | Enable in staging, validate persistence-backed workflows, then roll out to production with rollback plan. |
| Concurrency policy change | Adjust `MAX_BULK_CONCURRENCY`, observe rate-limit metrics, and iterate until baseline stabilises. |

## 6. Reference Links

* Full operational doctrine: `docs/HANDBOOK.md`
* Safety contract: repository `AGENTS.md`
* MCP tool registry: `src/mcp/tools/registerTools.ts`
* Usecase implementations: `src/application/usecases/`
* Gateway integrations: `src/infrastructure/clickup/`
* Test suites: `tests/`

Keep this runbook synced with production practices and update both documents whenever processes evolve.
