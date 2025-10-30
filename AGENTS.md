# ClickUp-MCP: Agent Intent and Cognitive Contract

## 1. Core Purpose
ClickUp-MCP is an autonomous Model-Context-Protocol (MCP) server that exposes structured, explainable, workflow-centric tools for orchestrating ClickUp operations. It is **not** a direct REST wrapper; every interaction re-expresses ClickUp functionality as cognitive primitives that large language model (LLM) agents can plan with and reason about deterministically. The server is engineered to deliver maintainability, portability across runtimes, predictable reasoning paths for agents, token-light responses that respect shared budgets, and deterministic, introspectable behaviour for every tool invocation.

## 2. Architectural Model
ClickUp-MCP adheres to a disciplined three-layer architecture that preserves separation of concerns and maximises explainability:

| Layer                        | Purpose                       | Responsibility                                            |
| ---------------------------- | ----------------------------- | --------------------------------------------------------- |
| **Application / Usecases**   | Orchestrates domain logic     | Validates inputs against schemas, enforces character budgets, maps gateway results into structured envelopes |
| **Infrastructure / Gateway** | Talks to ClickUp API          | Normalises remote errors, applies retries, and enforces rate-limit handling |
| **MCP / Tools**              | Exposes structured interfaces | Defines schemas, tool metadata, and planning context for agents |

```
┌────────────────────────────┐
│  LLM Agent / User          │
│  (Reasoning + Planning)    │
└────────────┬───────────────┘
             │  Model Context Protocol (STDIO)
┌────────────▼───────────────┐
│  ClickUp-MCP Server        │
│  • Tool Schemas            │
│  • Usecases & Gateway      │
│  • Safety Middleware       │
└────────────┬───────────────┘
             │  REST API (authorised)
┌────────────▼───────────────┐
│  ClickUp Platform          │
└────────────────────────────┘
```

Every tool is a pure function over the current model context. Responses emit predictable `structuredContent` objects and optional `guidance` narratives that inform subsequent reasoning without altering state.

## 3. Cognitive Foundations (from mcp_builder principles)
ClickUp-MCP aligns with Anthropic's skill framework for safe, reusable cognition:

1. **Transparency** — every response exposes exactly what the agent perceives; there is no hidden computation path.
2. **Grounded reasoning** — agents reason from validated structured data, never from unverified assumptions or hallucinated context.
3. **Consistency** — identical inputs yield identical structured outputs, enabling deterministic planning.
4. **Iterative reflection** — agents reflect between actions and validate intermediate outcomes before proceeding.
5. **Context fidelity** — only short-term context is preserved, ensuring reproducibility and minimal hidden state.
6. **Controlled verbosity** — outputs prioritise compact, token-efficient summaries aligned with shared budgets.
7. **Semantic clarity** — fields mirror user-facing terminology rather than opaque internal identifiers wherever possible.
8. **Explainability** — each tool may emit `guidance` describing safe next steps or verification hints.
9. **Determinism before creativity** — stable, reproducible results take precedence; creative synthesis belongs to higher-level reasoning loops.
10. **Composability** — tool outputs interoperate cleanly so that any result can feed the next reasoning step.
11. **Safety by design** — destructive operations require explicit confirmation and support dry-run evaluation.
12. **Observability** — health signals, metrics, and logs exist for external oversight and diagnostic purposes.

## 4. Agent Responsibilities and Behaviour Rules
**Must**

* Respect every JSON-schema definition exactly, including nullable fields and enum domains.
* Honour `confirm` and `dryRun` semantics before mutating any remote ClickUp data.
* Interpret `truncated: true` as an instruction to narrow filters or request paginated follow-ups.
* Treat `guidance` as advisory context for follow-up reasoning, not as executable commands.
* Retry operations with exponential backoff upon encountering rate-limit or transient network errors.
* Keep prompts token-lean by summarising large result sets before reusing them in planning.

**Must not**

* Invoke raw ClickUp API endpoints directly or bypass gateway invariants.
* Circumvent rate-limits, safety wrappers, or monitoring hooks.
* Persist authentication tokens or credentials outside the secured runtime.
* Fabricate identifiers or assume hidden fields; only use data explicitly returned by tools.

## 5. Reasoning and Execution Loop
Agents operate within a disciplined five-step cognitive loop derived from mcp_builder:

1. **Observe** — call read-only tools (tasks, hierarchy, time, docs) to establish the working context.
2. **Hypothesise** — formulate potential plans, updates, or corrective actions based on observed data.
3. **Act** — execute a mutating tool call with required confirmations or dry-runs.
4. **Reflect** — re-query relevant read-only tools to verify that the intended change materialised.
5. **Summarise** — deliver an interpretable report, follow-up plan, or next-step guidance to the user or supervising agent.

No agent may chain more than three mutating actions without an explicit verification stage that observes the resulting state.

## 6. Tool Taxonomy and Domain Expectations
| Domain           | Example Tools                                             | Typical Input              | Expected Output            | Agent Usage     |
| ---------------- | --------------------------------------------------------- | -------------------------- | -------------------------- | --------------- |
| **Tasks**        | create, update, comment, move, tag                        | list_id, name, metadata    | JSON with task object      | Task lifecycle  |
| **Hierarchy**    | list_spaces, list_folders, list_lists                     | team_id or space_id        | Arrays of structured items | Navigation      |
| **Time**         | report_time_for_tag / space_tag                           | team_id, tag or space_id   | Aggregated totals          | Time analysis   |
| **Docs**         | create_doc, list_doc_pages, get_doc_page, update_doc_page | workspace_id, doc/page ids | Structured doc info        | Knowledge ops   |
| **Views/Boards** | list_views, create_board_view, update_view, delete_view   | parentRef                  | Views list or ref          | Visual planning |
| **Search**       | fuzzy_task_search, doc_search                             | query                      | Ranked results             | Discovery       |
| **Safety**       | confirmation, dry-run                                     | confirm:"yes"              | Result envelope            | Guardrails      |
| **System**       | health, metrics                                           | none                       | Status JSON                | Monitoring      |

Outputs are stable, capped, and deterministically sorted. A global `CHARACTER_LIMIT = 25000` constrains combined character payloads. When truncation occurs, the `guidance` field instructs agents on how to refine scope or pagination.

## 7. Data, Memory, and Token Management
Agents maintain disciplined state handling:

* Retain only short-term working memory comprising the last 3–5 tool results.
* Discard raw large content once summarised to conserve token budgets.
* Favour compression order: Markdown → JSON → natural language prose when re-serialising context.
* Reuse cached context keys only within published TTLs (60 s for spaces/tasks, 30 s for docs) before revalidation.
* Avoid storing embeddings or performing long-term vector retrieval unless explicitly delegated to external services.
* For multi-document workflows, aggregate by identifiers rather than raw text and never exceed `CHARACTER_LIMIT` when composing compound reasoning outputs.

## 8. Safety, Trust, and Governance
ClickUp-MCP embeds safety and governance controls derived from Prompt 14 and mcp_builder ethics:

* **Confirmations** — every destructive tool mandates `confirm: "yes"` before execution.
* **Dry-runs** — any tool may accept `dryRun: true` to preview state changes without committing them.
* **Limits** — environment variables constrain attachment sizes, concurrency, and rate-limits.
* **Error semantics** — gateway responses normalise to `INVALID_PARAMETER`, `LIMIT_EXCEEDED`, or `CLICKUP_ERROR` to guide corrective action.
* **Trust model** — agents operate under least privilege; credentials are environment-bound and never surfaced downstream.
* **Governance** — destructive actions require explicit user initiation or supervisory approval, and agents must log reasoning context for auditability when acting autonomously.

## 9. Communication Semantics
ClickUp-MCP communicates via standard MCP envelopes:

* **Transport** — STDIO (default) with optional HTTP bridge for hosted scenarios.
* **Schemas** — `ListToolsRequestSchema` and `CallToolRequestSchema` define discovery and invocation interfaces.
* **Response structure** —

  ```json
  {
    "content": [{ "type": "json" | "text", "json"?: { ... }, "text"?: "..." }],
    "structuredContent": { ... },
    "guidance": "string",
    "truncated": false
  }
  ```
* Tools respond synchronously; streaming applies only when textual guidance exceeds 1 000 characters.
* All timestamps follow ISO-8601 in UTC.
* Boolean fields default to `false` unless explicitly set.

## 10. Development and Extension Standards
Maintainers and LLM-based extensions must uphold the following:

* **File organisation**
  * `src/mcp/tools/schemas/` — all Zod schemas.
  * `src/application/usecases/` — orchestration logic.
  * `src/infrastructure/clickup/` — gateway translation methods.
  * `src/mcp/tools/registerTools.ts` — canonical registration map.
* **Naming** — adopt `clickup_{domain}_{verb}` for tool identifiers and implementation files.
* **New tools** — each addition requires a schema, usecase, gateway call, and Vitest coverage ≥ 90 %.
* **Static checks** — `pnpm typecheck && pnpm lint` are mandatory prior to merge.
* **Documentation** — update `AGENTS.md` and `AUDIT.md` with every behavioural change.
* **Testing hierarchy** — prioritise Unit → Integration → Behavioural (agent-level) coverage.
* **Code style** — avoid inline comments; rely on expressive naming and schema typing for clarity.

### Runtime transport configuration
* STDIO transport remains the default (`MCP_TRANSPORT=stdio`).
* Hosted HTTP deployments are enabled by setting `MCP_TRANSPORT=http`.
* HTTP mode honours the following environment variables (optional unless noted):
  * `MCP_HTTP_PORT` / `PORT` (default `3000`).
  * `MCP_HTTP_HOST` (default `0.0.0.0`).
  * `MCP_HTTP_CORS_ALLOW_ORIGIN`, `MCP_HTTP_CORS_ALLOW_HEADERS`, `MCP_HTTP_CORS_ALLOW_METHODS`.
  * `MCP_HTTP_ENABLE_JSON_RESPONSE`, `MCP_HTTP_ALLOWED_HOSTS`, `MCP_HTTP_ALLOWED_ORIGINS`, `MCP_HTTP_ENABLE_DNS_REBINDING_PROTECTION`.
  * `MCP_HTTP_INITIALIZE_TIMEOUT_MS` (default `45000`) to control the HTTP bridge timeout for `initialize` requests.
* HTTP responses include permissive CORS headers unless overridden via the env vars above.
* The HTTP bridge now proxies requests through the SDK’s `StreamableHTTPServerTransport`, ensuring Smithery’s Streamable HTTP expectations (chunked responses, SSE negotiation, DNS rebinding guards) are satisfied without bespoke framing logic.
* `initialize` validates Smithery configuration and returns `INVALID_PARAMS` when required credentials (`apiToken`, `defaultTeamId`) are absent, keeping the HTTP bridge healthy while still allowing the unauthenticated `health` tool to respond.
* Both transports emit `tools/list_changed` notifications after connection to signal readiness.
* The HTTP bridge now accepts POST requests on both `/` and `/mcp`, serves `GET /healthz`, caps JSON bodies at 1 MB, and honours `OPTIONS` for those paths with CORS headers.
* `MCP_DEBUG` defaults to `1`, which logs the request line and status for each HTTP interaction without exposing payloads.
* The HTTP bridge now normalises missing or incomplete POST `Accept` headers to advertise both `application/json` and `text/event-stream`, ensuring hosted scanners that only request JSON can complete `initialize` without manual header overrides.

### Tool gating configuration
* Allow-list and deny-list behaviour is controlled via the environment variables `MCP_TOOLS_ALLOW`, `MCP_TOOLS_ALLOW_LIST`, `MCP_TOOL_ALLOW`, `MCP_TOOL_ALLOW_LIST`, `MCP_TOOLS_DENY`, `MCP_TOOLS_DENY_LIST`, `MCP_TOOL_DENY`, and `MCP_TOOL_DENY_LIST`.
* Smithery overrides expose the same controls through `allowTools` and `denyTools` entries in the configuration schema; these take precedence over environment variables when provided.
* When gating excludes a tool the server emits `tool_gate_skipped` logs and records a summary with `tool_gate_configured` and `tool_gate_applied`; ensure any new tooling respects this audit trail.

## 11. Workflow Examples and Patterns
### Example A: Automated backlog triage
Intent: ensure urgent issues receive prompt attention without unsafe automation.
1. Invoke `clickup_search_tasks` to locate tasks containing “bug” or “error”.
2. Filter locally for `status: "open"` to focus on actionable work.
3. Call `clickup_update_task` with `dryRun: true` to preview priority adjustments.
4. Repeat the call with `confirm: "yes"` once the plan is validated.
5. Use `clickup_comment_task` to record rationale and next steps for human stakeholders.

### Example B: Knowledge summarisation from docs
Intent: consolidate distributed documentation safely under token limits.
1. Use `clickup_list_doc_pages` to identify pages referencing “API”.
2. For each relevant page, execute `clickup_get_doc_page` with `contentFormat: "text/md"` for compressed retrieval.
3. Summarise results within the `CHARACTER_LIMIT`, preferring Markdown bulleting.
4. Publish the summary through `clickup_create_doc` in the “Engineering” hierarchy, including guidance for future updates.

### Example C: Time analysis by tag
Intent: evaluate time spent on review activities while preserving traceability.
1. Call `clickup_report_time_for_space_tag` with the appropriate `spaceId` and `tag: "review"`.
2. Aggregate the returned `byMember` totals into a Markdown table or JSON summary.
3. Optionally persist the findings with `clickup_create_doc`, titled “Weekly Review Summary”, highlighting data provenance and verification steps.

## 12. Glossary and Reference Sources
* **MCP** — Model Context Protocol, a bidirectional transport between reasoning models and structured tool surfaces.
* **Tool** — a schema-defined RPC endpoint implementing an atomic, explainable function exposed to agents.
* **Usecase** — an orchestration component that binds validation, gateway access, and response shaping.
* **Gateway** — a REST translator layer that enforces safety, retries, and error normalisation.
* **Guidance** — an optional response field offering safe next steps or verification prompts.
* **Truncation** — a character cap mechanism that protects token budgets and signals refinement needs.
* **Anthropic Skill** — the cognitive and ethical framework ensuring safe, reflective reasoning and introspection.

**Reference sources**
* Model Context Protocol specification.
* ClickUp API v2/v3 documentation.
* Anthropic Skill: “Safe, Reusable Cognition” (sections 2–5).
* ISO-8601 time format reference.
* OWASP API Security Top 10 (for ongoing governance review).
