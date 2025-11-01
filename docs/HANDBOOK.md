# ClickUp-MCP Operational Handbook

This handbook consolidates safety doctrine, configuration guidance, maintenance procedures, and upgrade playbooks for the ClickUp-MCP server. It applies to engineers, operators, and LLM agents collaborating on the platform.

## 1. System Overview

### 1.1 Architecture Flow

```
LLM Agent / User
        ↓
  MCP Server Entry (tools registry)
        ↓
Infrastructure Gateway → ClickUp REST API
        ↓
 Application Usecases
        ↓
  Schema Validation
        ↓
 Automated Tests (unit → integration)
```

* **Server layer** — exposes MCP tools through `src/mcp/tools/registerTools.ts`, resolves authentication, and ensures STDIO transport semantics.
* **Gateway layer** — resides in `src/infrastructure/clickup/`, translating MCP requests into ClickUp REST calls while normalising transient failures.
* **Usecase layer** — hosted under `src/application/usecases/`, orchestrating validation, feature flags, and domain-specific policies before delegating to the gateway.
* **Schema layer** — Zod definitions in `src/mcp/tools/schemas/` guarantee deterministic inputs and outputs for each tool.
* **Testing layer** — Vitest suites in `tests/` enforce behaviour across the stack, covering unit, integration, and behavioural contracts.

### 1.2 Operational Principles

1. **Determinism** — identical inputs must emit identical structured outputs.
2. **Transparency** — all responses surface the exact data perceived; no hidden context is carried between calls.
3. **Safety by design** — destructive actions require `confirm: "yes"` or `dryRun: true` before committing.
4. **Observability** — logs and metrics must remain actionable while respecting STDIO constraints.

## 2. Safety Doctrine

* Honour schema constraints exactly; reject or reshape inputs before invoking the gateway.
* Treat `truncated: true` responses as directives to narrow scope or paginate follow-up calls.
* Prefer `dryRun: true` for risky operations until validation is complete, then repeat with `confirm: "yes"`.
* Respect character budgets enforced by `CHARACTER_LIMIT` when composing outputs or aggregating downstream data.
* Log sensitive data only when redacted; authentication tokens stay within environment boundaries.
* No more than three mutating actions may occur without an explicit verification read-back.

## 3. Setup and Configuration

### 3.1 Prerequisites

* Node.js 20+
* pnpm or npm (repository scripts use npm by default)
* Access to a ClickUp API token with the least privileges necessary

### 3.2 Installation Steps

1. Install dependencies: `npm install`
2. Run static checks locally: `npm run lint` and `npm run typecheck`
3. Execute the test suite: `npm test`
4. Launch the development server (STDIO MCP transport): `npm run dev`

### 3.3 Runtime Environment Variables

| Variable | Description | Default | Notes |
| --- | --- | --- | --- |
| `CLICKUP_TOKEN` | Personal token used by the gateway to authenticate requests. | None | Required for any API interaction. |
| `CLICKUP_BASE_URL` | Base URL for ClickUp API calls. | `https://api.clickup.com` | Override for staging or mock servers. |
| `CLICKUP_AUTH_SCHEME` | Authorisation scheme header (for example `Bearer`). | `Bearer` | Use custom scheme when proxying credentials. |
| `CLICKUP_TIMEOUT_MS` | Timeout for outbound requests in milliseconds. | `10000` | Increase for slow networks; keep under 30 000 ms. |
| `CLICKUP_DEFAULT_TEAM_ID` | Fallback team identifier applied when a tool input omits one. | `0` | Use only when a single-team deployment is assumed. |
| `LOG_LEVEL` | Granularity of operational logging. | `info` | Accepts `debug`, `info`, `warn`, `error`. |
| `FEATURE_PERSISTENCE` | Enables persistence-dependent features for long-running sessions. | `false` | Set to `true` only when persistence storage is configured. |
| `MCP_HTTP_INITIALIZE_TIMEOUT_MS` | Timeout for the HTTP bridge `initialize` handshake in milliseconds. | `45000` | Honoured by the HTTP transport; overrides the fallback used when transport config omits a value. |
| `MAX_ATTACHMENT_MB` | Attachment size ceiling per request. | `8` | Converted to bytes internally. |
| `MAX_BULK_CONCURRENCY` | Concurrent outbound request cap during bulk operations. | `10` | Values below 1 are coerced to 1. |

### 3.4 Local Safety Rules

* Keep `LOG_LEVEL=debug` confined to ephemeral environments to avoid leaking sensitive payloads.
* Avoid hard-coding tokens; prefer `.env` files excluded from version control.
* When running automated agents, enforce `MAX_BULK_CONCURRENCY` ≤ 5 until rate limits are validated.
* Capture stderr logs separately from STDOUT to preserve MCP message integrity.

## 4. Developer Workflows

### 4.1 Adding a New Tool

1. Define input/output schemas in `src/mcp/tools/schemas/yourTool.ts` using Zod.
2. Implement the orchestration usecase in `src/application/usecases/yourDomain/` ensuring validations and `dryRun` handling.
3. Extend the gateway within `src/infrastructure/clickup/` to translate the usecase into REST calls, including retry and error mapping logic.
4. Register the tool in `src/mcp/tools/registerTools.ts` with metadata, auth requirements, and schema wiring.
5. Create unit tests targeting schemas and usecases, then add integration coverage under `tests/`.
6. Run `npm run typecheck`, `npm run lint`, and `npm test` before opening a pull request.

### 4.2 Writing a Dry-Run Preview

1. Extend the relevant schema to accept `dryRun?: boolean` if not already present.
2. Update the usecase to branch on `dryRun`, invoking gateway preview functions or constructing simulated responses.
3. Ensure the gateway supports preview semantics without side effects; stub remote calls when ClickUp lacks native dry-run support.
4. Return `guidance` describing follow-up confirmation steps, and set `truncated` when previews exceed character budgets.
5. Add regression tests verifying that `dryRun: true` avoids mutations and emits the expected guidance string.

### 4.3 Extending an Existing Schema

1. Modify the schema file under `src/mcp/tools/schemas/` while preserving backward compatibility when possible.
2. Update usecase validators to accommodate new fields and propagate defaults.
3. Adjust gateway payload construction to include or map the new schema fields.
4. Revise tests to cover both legacy and extended scenarios, ensuring snapshots remain deterministic.
5. Document the change in release notes and update the MCP tool description if behaviour evolves.

## 5. Deployment, Monitoring, and Logging

### 5.1 Deployment Checklist

1. Build the project: `npm run build`
2. Package artefacts, including compiled JavaScript and `package.json`
3. Provision runtime secrets (`CLICKUP_TOKEN`, `LOG_LEVEL`, concurrency limits)
4. Configure process supervision (systemd, PM2, container orchestrator) to restart on failure
5. Validate connectivity by running the `health` tool via an MCP client post-deploy

### 5.2 Monitoring Signals

* **Health checks** — invoke the `health` tool periodically; alert on non-`ok` status.
* **Rate limits** — monitor retries emitted from gateway logs tagged with `LIMIT_EXCEEDED`.
* **Latency** — track response times per tool; investigate when exceeding timeout thresholds.
* **Character budgets** — flag repeated `truncated: true` responses as indicators of schema misuse or oversized payloads.

### 5.3 Logging Practices

* Logs stream to stderr to protect MCP STDOUT transport.
* Use JSON-formatted log entries to facilitate parsing in centralised systems.
* Redact tokens and user content before emitting logs at `debug` level.
* Rotate log files externally; the service itself remains stateless regarding log retention.

## 6. Maintenance and Upgrades

1. Schedule quarterly dependency reviews using `npm outdated` and address security advisories promptly.
2. Upgrade TypeScript or tooling in isolation, running `npm run typecheck` and targeted smoke tests after each change.
3. Revisit schemas and usecases following ClickUp API deprecations; remove legacy fields in a major release only.
4. Maintain `AGENTS.md` and the handbook when behaviour changes to keep LLM operators aligned.
5. Document feature toggles controlled by `FEATURE_PERSISTENCE` to prevent misconfiguration during upgrades.

## 7. Troubleshooting Guide

### 7.1 Common Issues

| Symptom | Likely Cause | Corrective Action |
| --- | --- | --- |
| Tools return `CLICKUP_ERROR` | Upstream API failure or authentication issue. | Confirm token validity, inspect stderr logs, retry with exponential backoff. |
| Responses marked `truncated: true` | Payload exceeds `CHARACTER_LIMIT`. | Narrow filters, paginate requests, or request targeted fields only. |
| Mutating call has no effect | Missing `confirm: "yes"` or `dryRun: true`. | Reissue with confirmation or disable dry-run. |
| Rate limit errors | Excessive concurrent requests. | Lower `MAX_BULK_CONCURRENCY`, implement retry backoff. |
| STDOUT contamination | Logs emitted to STDOUT. | Ensure logging targets stderr and update process supervisor configuration. |

### 7.2 Error-Code Glossary

| Code | Description | Recovery |
| --- | --- | --- |
| `INVALID_PARAMETER` | Input failed schema validation or ClickUp rejected the payload. | Revalidate inputs, verify schema updates, adjust usecase defaults. |
| `LIMIT_EXCEEDED` | ClickUp or local concurrency limit reached. | Reduce request volume, stagger tasks, revisit `MAX_BULK_CONCURRENCY`. |
| `CLICKUP_ERROR` | Generic upstream error from ClickUp API. | Inspect logs, retry with backoff, escalate to ClickUp support if persistent. |

### 7.3 Escalation Path

1. Capture recent stderr logs with timestamps and tool identifiers.
2. Reproduce the issue in a staging environment when possible.
3. Escalate to the platform maintainer with schema version, tool name, and reproduction steps.
4. Document resolution steps back in this handbook for future operators.

---

Maintain this handbook alongside code changes to ensure operational parity between documentation and implementation.
