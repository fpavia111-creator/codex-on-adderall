'use strict';
/**
 * Safe defaults. this tool itself never edits files, runs git, or deletes anything: it only
 * produces briefs and records results. The one place it executes anything is the "command"
 * provider, and every such command is checked here first (allowlist + destructive patterns +
 * optional @kurtfrancisco/agent-guard policy).
 */
const path = require('path');

const DESTRUCTIVE = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, /\bgit\s+(push\s+.*(--force|-f)\b|reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D)/i,
  /\b(mkfs|dd\s+if=|shutdown|reboot|format)\b/i, /\bdrop\s+(table|database)\b/i, /\btruncate\s+table\b/i,
  /\bchmod\s+(-R\s+)?777\b/, /\bcurl\b[^|]*\|\s*(ba|z)?sh\b/i, />\s*\/dev\/sd[a-z]/, /\bnpm\s+publish\b/i,
  /--dangerously-skip-permissions|--yolo|--dangerously-bypass-approvals-and-sandbox/i,
];

function isDestructive(cmdline) { return DESTRUCTIVE.some(re => re.test(cmdline)); }

function loadAgentGuard(requireFn = require) {
  for (const name of ['@kurtfrancisco/talos', '@kurtfrancisco/agent-guard']) { // unscoped names are NOT trusted
    try { const m = requireFn(name); if (m && typeof m.evaluate === 'function') return { name, mod: m }; } catch { /* absent */ }
  }
  return null;
}

/** Returns {allowed, reasons[], guard}. Never throws. */
function checkCommand(argv, cfg, { requireFn } = {}) {
  const safety = cfg.safety || {};
  const reasons = [];
  if (!Array.isArray(argv) || !argv.length) return { allowed: false, reasons: ['empty command'] };
  const bin = path.basename(String(argv[0]));
  const line = argv.map(String).join(' ');
  if (!(safety.allowedCommands || []).includes(bin)) reasons.push(`"${bin}" is not in safety.allowedCommands`);
  if (!safety.allowDestructive && isDestructive(line)) reasons.push('destructive pattern blocked (safety.allowDestructive=false)');
  let guard = null;
  if (safety.agentGuard !== 'off') {
    const g = loadAgentGuard(requireFn);
    if (g) {
      try {
        const r = g.mod.evaluate({ tool: 'Bash', command: line, projectRoot: cfg.projectRoot });
        guard = { engine: g.name, decision: r.decision, reason: r.reason || null, profile: r.profile, hits: (r.hits || []).map(h => ({ guard: h.guard, rule: h.rule, severity: h.severity, message: h.message })) };
        if (r.decision === 'deny') reasons.push(`agent-guard: ${r.reason}`);
      } catch (e) { guard = { engine: g.name, error: e.message }; if (safety.agentGuard === 'required') reasons.push('agent-guard errored'); }
    } else if (safety.agentGuard === 'required') reasons.push('safety.agentGuard=required but @kurtfrancisco/agent-guard is not installed');
  }
  return { allowed: reasons.length === 0, reasons, guard };
}

module.exports = { checkCommand, isDestructive, loadAgentGuard, DESTRUCTIVE };
