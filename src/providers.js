'use strict';
/** Model providers: host (the calling agent), command (local CLI), mock (tests). */
const { spawnSync } = require('child_process');
const { checkCommand } = require('./safety');

const MOCK = {
  plan: '## Plan\n1. Read the relevant files.\n2. Implement the change.\n3. Add tests for each acceptance item.\n',
  build: '## Build report\nChanged files: (mock)\nTests: pass (mock)\n',
  review: '## Review\nAll acceptance criteria checked.\nVERDICT: APPROVE\n',
};

/** Pull token usage from CLI output if it prints JSON usage (claude/codex --json style). */
function parseUsage(text) {
  const re = /"(input_tokens|prompt_tokens|inputTokens)"\s*:\s*(\d+)[\s\S]*?"(output_tokens|completion_tokens|outputTokens)"\s*:\s*(\d+)/;
  const m = String(text).match(re);
  return m ? { inputTokens: Number(m[2]), outputTokens: Number(m[4]) } : null;
}

function runCommand(role, roleCfg, brief, cfg, deps = {}) {
  const argv = roleCfg.command.map(String);
  const verdict = checkCommand(argv, cfg, deps);
  if (!verdict.allowed) { const e = new Error(`command blocked for ${role}: ${verdict.reasons.join('; ')}`); e.code = 'COA_BLOCKED'; e.safety = verdict; throw e; }
  const spawn = deps.spawnSync || spawnSync;
  const r = spawn(argv[0], argv.slice(1), { input: brief, encoding: 'utf8', cwd: cfg.projectRoot, timeout: cfg.safety.commandTimeoutMs, maxBuffer: 32 * 1024 * 1024, shell: false });
  if (r.error) throw new Error(`${role} command failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${role} command exited ${r.status}: ${String(r.stderr || '').slice(0, 500)}`);
  const output = String(r.stdout || '');
  return { output, usage: parseUsage(output), safety: verdict };
}

function execute(role, roleCfg, brief, cfg, deps = {}) {
  if (roleCfg.provider === 'mock') return { output: roleCfg.mockOutput || MOCK[role], usage: roleCfg.mockUsage || null };
  if (roleCfg.provider === 'command') return runCommand(role, roleCfg, brief, cfg, deps);
  throw new Error(`provider ${roleCfg.provider} is not executable by the server (host steps are done by the calling agent)`);
}

module.exports = { execute, parseUsage, MOCK };
