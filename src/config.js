'use strict';
/** Configuration: coa.config.json in the project root, merged over safe defaults. */
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  // Each role is served by a provider:
  //   "host"    - the calling agent (Claude Code / Cursor / Codex) does the step itself;
  //               the orchestrator hands it a brief and records the result. Default: costs nothing extra.
  //   "command" - the orchestrator runs a local CLI (e.g. `claude -p`, `codex exec`) with the brief on stdin.
  //   "mock"    - deterministic canned output, for tests and dry runs.
  roles: {
    plan: { provider: 'host', model: 'host', pricing: { inputPerM: 0, outputPerM: 0 } },
    build: { provider: 'host', model: 'host', pricing: { inputPerM: 0, outputPerM: 0 } },
    review: { provider: 'host', model: 'host', pricing: { inputPerM: 0, outputPerM: 0 } },
  },
  budgets: {
    perRun: { usd: 2, tokens: 400000 },
    perDay: { usd: 10, tokens: 2000000 },
  },
  specGate: { minScore: 70, external: 'auto' },
  review: { maxRounds: 2 },
  safety: {
    allowDestructive: false,
    agentGuard: 'auto', // auto | required | off
    allowedCommands: ['claude', 'codex', 'cursor-agent', 'gemini', 'ollama', 'llm', 'node'],
    commandTimeoutMs: 15 * 60 * 1000,
  },
  vet: { mcpscan: 'auto', blockOn: 'high' },
  stateDir: '.coa',
});

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

function loadConfig(projectRoot = process.cwd(), overrides = {}) {
  let file = {};
  const p = overrides.configPath || path.join(projectRoot, 'coa.config.json');
  if (fs.existsSync(p)) {
    try { file = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { throw new Error(`coa: cannot parse ${p}: ${e.message}`); }
  }
  const { configPath, ...rest } = overrides;
  const cfg = merge(merge(JSON.parse(JSON.stringify(DEFAULTS)), file), rest);
  cfg.projectRoot = path.resolve(projectRoot);
  cfg.stateDirAbs = path.resolve(cfg.projectRoot, cfg.stateDir);
  validateConfig(cfg);
  return cfg;
}

function validateConfig(cfg) {
  for (const role of ['plan', 'build', 'review']) {
    const r = cfg.roles[role];
    if (!r) throw new Error(`coa: roles.${role} missing`);
    if (!['host', 'command', 'mock'].includes(r.provider)) throw new Error(`coa: roles.${role}.provider must be host|command|mock`);
    if (r.provider === 'command' && (!Array.isArray(r.command) || !r.command.length)) throw new Error(`coa: roles.${role}.command must be a non-empty array`);
  }
  for (const scope of ['perRun', 'perDay']) {
    const b = cfg.budgets[scope] || {};
    for (const k of ['usd', 'tokens']) if (b[k] != null && !(typeof b[k] === 'number' && b[k] >= 0)) throw new Error(`coa: budgets.${scope}.${k} must be a non-negative number`);
  }
  return true;
}

module.exports = { DEFAULTS, loadConfig, validateConfig, merge };
