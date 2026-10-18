# Codex on Adderall

**Plan → build → review across models, from Claude Code, Cursor, or Codex.** A zero-dependency MCP server (`coa`) that won't hand off work until the spec is checkable, vets the tools a worker gets, stops hard at your per-run and per-day cost/token budgets, never runs destructive actions, and logs every step.

> Based on [Codex on Crack](https://github.com/ethanplusai/codex-on-crack) by Ethan Rogers (MIT). Not affiliated with or endorsed by Ethan Rogers or OpenAI. "Codex" refers to the OpenAI Codex CLI this tool works with.

## Why
Codex on Crack showed that one agent planning, another implementing, and a lead reviewing gets better results than a single model. It runs inside Codex. Codex on Adderall takes the same loop and makes it host-independent, then adds guardrails:

| | |
|---|---|
| **Any host** | One MCP server for Claude Code, Cursor and Codex. Each role (plan/build/review) is served by `host` (your current agent does it, at no extra cost), `command` (a local CLI such as `claude -p`, `codex exec`, `ollama run`), or `mock`. |
| **Spec gate** | No handoff until the spec has a goal, acceptance criteria as a checklist, scope, a test plan and named files. Vague items and TBDs lose points. Uses `@kurtfrancisco/specgate` too when it's installed. |
| **Tool vetting** | Worker tools are checked for prompt injection, hidden tags, credential paths, invisible unicode and exfiltration URLs. Uses `@kurtfrancisco/mcpscan` too when installed. Blocked tools are left out of the build brief. |
| **Hard budgets** | USD and token limits per run and per day. A preflight estimate stops a call *before* it would cross a limit, and actual usage is checked after every step. A stopped run says which limit it hit and how to raise it. |
| **Safe defaults** | The server never edits files, runs git, or deletes anything. CLI workers must be on an allowlist, run without a shell, and are refused for destructive patterns (`rm -rf`, force-push, `npm publish`, `--dangerously-skip-permissions`...). Uses `@kurtfrancisco/agent-guard` policy too when installed. |
| **Clear logs** | `.coa/runs/<id>/log.jsonl` plus `coa log` for people to read. Secrets are redacted. Every step records model, tokens and cost, and whether the counts were reported or estimated. |
| **Review loop** | The reviewer checks each acceptance criterion and ends with `VERDICT: APPROVE` or `VERDICT: CHANGES`. Changes go back to the builder until `review.maxRounds`, then the run hands back to you (`needs_human`). |

## Install (Node 18+)
```sh
# Claude Code
claude mcp add codex-on-adderall -- npx -y @kurtfrancisco/codex-on-adderall mcp
```
Cursor (`.cursor/mcp.json`) / Claude Code project (`.mcp.json`):
```json
{ "mcpServers": { "codex-on-adderall": { "command": "npx", "args": ["-y", "@kurtfrancisco/codex-on-adderall", "mcp"] } } }
```
Codex (`~/.codex/config.toml`):
```toml
[mcp_servers.codex-on-adderall]
command = "npx"
args = ["-y", "@kurtfrancisco/codex-on-adderall", "mcp"]
```

## Use it
Ask your agent: *"Use codex-on-adderall to run this spec: plan it, build it, then review it."* The agent calls `coa_start_run`, then `coa_next_step` / `coa_submit_step` for `host` steps, and `coa_run_auto` for CLI steps.

MCP tools: `coa_status`, `coa_spec_check`, `coa_vet_tools`, `coa_start_run`, `coa_next_step`, `coa_submit_step`, `coa_run_auto`, `coa_get_run`, `coa_list_runs`, `coa_budget`, `coa_log`, `coa_cancel`.

CLI:
```sh
npx @kurtfrancisco/codex-on-adderall init              # writes coa.config.json (all roles = host)
coa spec-check spec.md                                  # exit 1 if the gate fails
coa vet tools.json
coa run spec.md --tools tools.json                     # runs CLI steps; prints the brief for host steps
coa submit <runId> build build-report.md
coa runs | coa budget <runId> | coa log <runId> | coa doctor
```

## Configure (`coa.config.json`)
See `examples/coa.config.claude-codex.json`. The defaults:
```json
{
  "roles": { "plan": {"provider":"host"}, "build": {"provider":"host"}, "review": {"provider":"host"} },
  "budgets": { "perRun": {"usd": 2, "tokens": 400000}, "perDay": {"usd": 10, "tokens": 2000000} },
  "specGate": { "minScore": 70, "external": "auto" },
  "review": { "maxRounds": 2 },
  "safety": { "allowDestructive": false, "agentGuard": "auto", "allowedCommands": ["claude","codex","cursor-agent","gemini","ollama","llm","node"] },
  "vet": { "mcpscan": "auto", "blockOn": "high" }
}
```
`pricing` (`inputPerM`/`outputPerM` in USD) is per role and is yours to set. Costs are only as accurate as the prices you enter. When a CLI prints JSON usage (`input_tokens`/`output_tokens`) those counts are used; otherwise tokens are estimated at about 4 characters each and marked `estimated`. Set any integration to `"required"` to fail closed when it's missing.

## Integrations (optional, loaded only if installed)
`npm i -D @kurtfrancisco/specgate @kurtfrancisco/mcpscan @kurtfrancisco/agent-guard`
- **SpecGate**: pass a change id (`coa_start_run { specgateChange }` or `coa run spec.md --specgate-change add-x`). The run is blocked unless `specgate validate <id>` and `specgate status <id>` both exit 0, meaning the spec is well formed and a human has signed it off. Called through its CLI (no shell, no npx). If you give a change id and SpecGate isn't installed, the run fails closed.
- **mcpscan**: `require('@kurtfrancisco/mcpscan').checkToolDescription(tool)` runs on every worker tool. Its findings (`MCP0xx` rules) are merged with the built-in checks.
- **agent-guard**: `require('@kurtfrancisco/agent-guard').evaluate({ tool: 'Bash', command, projectRoot })` runs before any CLI worker starts. A `deny` decision blocks the command, even when `allowDestructive` is true.

Only these scoped names are loaded. Unscoped look-alikes are ignored.

## Pro ($11 launch price)
Routing presets (host-only, Claude plans/host builds, Codex builds/Claude reviews, local Ollama, max-quality), a review checklist, an HTML cost dashboard (daily spend, by role/model, per run), and a one-command installer that registers the server with all three hosts (dry run by default, with backups). Set `COA_LICENSE_KEY` from your purchase email. Keys are verified offline.

**[Buy codex-on-adderall Pro: $11 one-time →](https://buy.stripe.com/cNi8wRgqd6Fc5Gb0md5AQ05)**
Payment is handled by Stripe; your license key arrives by email.

## License
MIT. Copyright (c) 2026 Ethan Rogers (original Codex on Crack) and Copyright (c) 2026 Kurt Francisco (this derivative). See [LICENSE](LICENSE). Pro content is sold separately and isn't covered by the MIT license.
