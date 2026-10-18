'use strict';
/** Zero-dependency MCP server (stdio, JSON-RPC 2.0, newline-delimited) for Claude Code, Cursor and Codex. */
const readline = require('readline');
const NAME = require('./name');
const { Orchestrator } = require('./orchestrator');
const { checkSpec } = require('./specgate');
const { vetTools } = require('./vet');
const { checkCommand } = require('./safety');
const pkg = require('../package.json');

const obj = (props, required = []) => ({ type: 'object', properties: props, required });
const S = { type: 'string' };
const P = 'coa_';
const TOOLS = [
  { name: P + 'status', description: 'Show role routing (plan/build/review providers and models), budgets used today, safety settings and which optional integrations (specgate, mcpscan, agent-guard) are installed.', inputSchema: obj({}) },
  { name: P + 'spec_check', description: 'Score a markdown spec with the spec gate (goal, acceptance criteria, scope, test plan, files). Runs never hand off to a builder unless this passes.', inputSchema: obj({ spec: S, specgateChange: S }, ['spec']) },
  { name: P + 'vet_tools', description: 'Vet MCP tool definitions ({name, description, inputSchema}[]) for poisoned descriptions before giving them to a worker.', inputSchema: obj({ tools: { type: 'array', items: { type: 'object' } } }, ['tools']) },
  { name: P + 'start_run', description: 'Start a plan -> build -> review run from a markdown spec. Applies the spec gate and tool vetting; returns the run and the first step.', inputSchema: obj({ spec: S, title: S, tools: { type: 'array', items: { type: 'object' } }, specgateChange: { type: 'string', description: 'Optional @kurtfrancisco/specgate change id; the run is blocked unless `specgate validate` and `specgate status` (human sign-off) pass.' } }, ['spec']) },
  { name: P + 'next_step', description: 'Get the next step of a run: role, provider, and the brief. If provider is "host", do the step yourself and call coa_submit_step with the result.', inputSchema: obj({ runId: S }, ['runId']) },
  { name: P + 'submit_step', description: 'Submit the result of a host step (plan text, build report, or review ending in "VERDICT: APPROVE" / "VERDICT: CHANGES"). Pass token counts if known; otherwise they are estimated.', inputSchema: obj({ runId: S, role: { type: 'string', enum: ['plan', 'build', 'review'] }, output: S, inputTokens: { type: 'number' }, outputTokens: { type: 'number' }, model: S }, ['runId', 'role', 'output']) },
  { name: P + 'run_auto', description: 'Execute every step served by a configured local CLI (command provider) until the run finishes, hits a budget hard stop, or reaches a host step.', inputSchema: obj({ runId: S }, ['runId']) },
  { name: P + 'get_run', description: 'Full run record: spec gate result, plan, builds, reviews, steps with token/cost usage.', inputSchema: obj({ runId: S }, ['runId']) },
  { name: P + 'list_runs', description: 'List runs with status and usage.', inputSchema: obj({}) },
  { name: P + 'budget', description: 'Per-run and per-day token/USD usage against the hard limits.', inputSchema: obj({ runId: S }) },
  { name: P + 'log', description: 'Recent log entries for a run (or all runs).', inputSchema: obj({ runId: S, limit: { type: 'number' } }) },
  { name: P + 'cancel', description: 'Cancel a run.', inputSchema: obj({ runId: S, reason: S }, ['runId']) },
];

function has(name) { try { require.resolve(name); return true; } catch { return false; } }

async function callTool(o, name, a = {}) {
  switch (name) {
    case P + 'status': return {
      name: NAME.DISPLAY_NAME, version: pkg.version,
      roles: Object.fromEntries(Object.entries(o.cfg.roles).map(([k, v]) => [k, { provider: v.provider, model: v.model, command: v.command ? v.command[0] : undefined }])),
      budget: o.budget.summary(), safety: { allowDestructive: o.cfg.safety.allowDestructive, agentGuard: o.cfg.safety.agentGuard, allowedCommands: o.cfg.safety.allowedCommands },
      integrations: { specgate: has('@kurtfrancisco/janus') || has('@kurtfrancisco/specgate'), mcpscan: has('@kurtfrancisco/argus') || has('@kurtfrancisco/mcpscan'), agentGuard: has('@kurtfrancisco/talos') || has('@kurtfrancisco/agent-guard') },
    };
    case P + 'spec_check': return checkSpec(a.spec, o.cfg, { change: a.specgateChange });
    case P + 'vet_tools': return vetTools(a.tools || [], o.cfg);
    case P + 'start_run': { const run = await o.start(a); return { run: summarize(run), next: o.next(run.id) }; }
    case P + 'next_step': return o.next(a.runId);
    case P + 'submit_step': { const run = o.submit(a.runId, a.role, a); return { run: summarize(run), next: o.next(run.id) }; }
    case P + 'run_auto': { const r = await o.auto(a.runId); return { run: summarize(r.run), next: o.next(r.run.id) }; }
    case P + 'get_run': return o.get(a.runId);
    case P + 'list_runs': return o.list();
    case P + 'budget': return o.budget.summary(a.runId);
    case P + 'log': return o.log.read(a.runId || null, a.limit || 100);
    case P + 'cancel': return summarize(o.cancel(a.runId, a.reason));
    default: throw new Error(`unknown tool ${name}`);
  }
}

function summarize(run) {
  return { id: run.id, title: run.title, status: run.status, next: run.next, round: run.round, stopReason: run.stopReason,
    specGate: { pass: run.gate.pass, score: run.gate.score, missing: run.gate.missing }, tools: { allowed: run.tools.allowed, blocked: run.tools.blocked } };
}

async function handle(msg, makeO) {
  const { id, method, params = {} } = msg;
  const ok = result => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return ok({ protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: NAME.SLUG, version: pkg.version } });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    try { const r = await callTool(makeO(), params.name, params.arguments || {}); return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }); }
    catch (e) { return ok({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }); }
  }
  if (id === undefined || id === null) return null; // notification
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

function start({ projectRoot = process.cwd(), input = process.stdin, output = process.stdout } = {}) {
  const makeO = () => new Orchestrator(projectRoot);
  const rl = readline.createInterface({ input });
  rl.on('line', async line => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
    const res = await handle(msg, makeO);
    if (res) output.write(JSON.stringify(res) + '\n');
  });
  return rl;
}

module.exports = { start, handle, TOOLS, callTool, checkCommand };
