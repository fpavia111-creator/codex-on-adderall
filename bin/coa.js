#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const NAME = require('../src/name');
const { Orchestrator } = require('../src/orchestrator');
const { checkSpec } = require('../src/specgate');
const { vetTools } = require('../src/vet');
const { loadConfig, DEFAULTS } = require('../src/config');
const { format } = require('../src/log');
const pkg = require('../package.json');

const HELP = `${NAME.DISPLAY_NAME} ${pkg.version} - plan -> build -> review across models, as an MCP server.

Usage: ${NAME.BIN} <command> [options]
  mcp                         Start the MCP server on stdio (for Claude Code, Cursor, Codex)
  init                        Write coa.config.json with safe defaults (won't overwrite)
  spec-check <spec.md>        Score a spec with the spec gate (exit 1 if it fails)
                              --specgate-change <id> also requires SpecGate validate + human sign-off
  vet <tools.json>            Vet MCP tool definitions for poisoned descriptions (exit 1 if blocked)
  run <spec.md> [--tools f]   Start a run and auto-execute command-provider steps
  next <runId>                Show the next step and its brief
  submit <runId> <role> <file> Record a host step's output from a file
  runs                        List runs
  show <runId>                Print a run as JSON
  budget [runId]              Usage vs per-run/per-day hard limits
  log [runId]                 Human-readable log
  cancel <runId>              Cancel a run
  doctor                      Check config, Node version and optional integrations
Options: --root <dir> (project root, default cwd)  --json`;

function arg(flag) { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : undefined; }
const root = path.resolve(arg('--root') || process.cwd());
const json = process.argv.includes('--json');
const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && ['--root', '--tools', '--specgate-change'].includes(all[i - 1])));
const out = v => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const readText = f => fs.readFileSync(path.resolve(f), 'utf8');

function printNext(n) {
  if (json) return out(n);
  if (n.done) return out(`Run ${n.runId}: ${n.status}`);
  out(`Run ${n.runId}: next step "${n.role}" (round ${n.round}) via ${n.provider}/${n.model}\n--- brief ---\n${n.brief}`);
}

async function main() {
  const [cmd, a1, a2, a3] = pos;
  switch (cmd) {
    case 'mcp': return require('../src/mcp').start({ projectRoot: root });
    case 'init': {
      const f = path.join(root, 'coa.config.json');
      if (fs.existsSync(f)) return out(`${f} already exists; not overwriting.`);
      const { stateDir, ...rest } = JSON.parse(JSON.stringify(DEFAULTS));
      fs.writeFileSync(f, JSON.stringify(rest, null, 2) + '\n');
      return out(`Wrote ${f}. All roles default to "host" (your agent does each step; no extra spend).`);
    }
    case 'spec-check': {
      const r = await checkSpec(readText(a1), loadConfig(root), { change: arg('--specgate-change') });
      if (json) out(r); else {
        out(`Spec gate: ${r.pass ? 'PASS' : 'FAIL'}  score ${r.score}/${r.minScore} (${r.engine})`);
        for (const m of r.missing) out(`  missing ${m.section}: ${m.hint}`);
        for (const n of r.notes) out(`  note: ${n}`);
      }
      process.exitCode = r.pass ? 0 : 1; return;
    }
    case 'vet': {
      const r = vetTools(JSON.parse(readText(a1)), loadConfig(root));
      if (json) out(r); else {
        out(`Tool vetting (${r.scanner}): ${r.ok ? 'OK' : 'BLOCKED'}  allowed ${r.allowedTools.length}, blocked ${r.blockedTools.length}`);
        for (const t of r.results) for (const f of t.findings) out(`  ${t.blocked ? 'BLOCK' : 'warn '} ${t.tool}: [${f.severity}] ${f.rule} ${f.message}`);
      }
      process.exitCode = r.ok ? 0 : 1; return;
    }
    case 'run': {
      const o = new Orchestrator(root, { echo: !json });
      const tools = arg('--tools') ? JSON.parse(readText(arg('--tools'))) : [];
      const run = await o.start({ spec: readText(a1), tools, specgateChange: arg('--specgate-change') });
      if (run.status.startsWith('blocked')) { out(json ? run : `Run ${run.id} ${run.status}. Fix the spec/tools and retry (see: ${NAME.BIN} show ${run.id}).`); process.exitCode = 1; return; }
      const r = await o.auto(run.id);
      printNext(o.next(r.run.id));
      if (['failed', 'stopped_budget', 'needs_human'].includes(r.run.status)) { out(`Stopped: ${r.run.stopReason}`); process.exitCode = 1; }
      return;
    }
    case 'next': return printNext(new Orchestrator(root).next(a1));
    case 'submit': { const o = new Orchestrator(root); const run = o.submit(a1, a2, { output: readText(a3) }); return printNext(o.next(run.id)); }
    case 'runs': { const l = new Orchestrator(root).list(); if (json) return out(l); if (!l.length) return out('No runs yet.'); for (const r of l) out(`${r.id}  ${r.status.padEnd(14)} $${r.usage.usd.toFixed(4)}  ${r.usage.tokens} tok  ${r.title}`); return; }
    case 'show': return out(new Orchestrator(root).get(a1));
    case 'budget': {
      const s = new Orchestrator(root).budget.summary(a1);
      if (json) return out(s);
      out(`Today: $${s.today.usd.toFixed(4)} / $${s.limits.perDay.usd}   ${s.today.tokens} / ${s.limits.perDay.tokens} tokens   (${s.today.calls} calls)`);
      if (s.run) out(`Run:   $${s.run.usd.toFixed(4)} / $${s.limits.perRun.usd}   ${s.run.tokens} / ${s.limits.perRun.tokens} tokens`);
      return;
    }
    case 'log': { const l = new Orchestrator(root).log.read(a1 || null, 500); return json ? out(l) : l.forEach(e => out(format(e))); }
    case 'cancel': return out(new Orchestrator(root).cancel(a1).status);
    case 'doctor': {
      const major = Number(process.versions.node.split('.')[0]);
      const has = n => { try { require.resolve(n); return 'installed'; } catch { return 'not installed (optional)'; } };
      let cfgMsg; try { const c = loadConfig(root); cfgMsg = `ok (${Object.entries(c.roles).map(([k, v]) => `${k}=${v.provider}`).join(', ')})`; } catch (e) { cfgMsg = e.message; process.exitCode = 1; }
      out(`${NAME.DISPLAY_NAME} ${pkg.version}\n  node ${process.versions.node} ${major >= 18 ? 'ok' : 'TOO OLD (need 18+)'}\n  config: ${cfgMsg}\n  @kurtfrancisco/specgate: ${has('@kurtfrancisco/specgate')}\n  @kurtfrancisco/mcpscan: ${has('@kurtfrancisco/mcpscan')}\n  @kurtfrancisco/agent-guard: ${has('@kurtfrancisco/agent-guard')}`);
      return;
    }
    case undefined: case 'help': case '-h': return out(HELP);
    default: out(HELP); process.exitCode = 2;
  }
}
main().catch(e => { console.error(`${NAME.BIN}: ${e.message}`); process.exitCode = 1; });
