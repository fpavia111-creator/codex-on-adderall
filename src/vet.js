'use strict';
/**
 * Vet the tools a worker will be given before handoff. Built-in checks for poisoned tool
 * descriptions, plus @kurtfrancisco/mcpscan (or mcpscan) checkToolDescription when installed.
 */
const SEV = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const RULES = [
  { id: 'TP001', sev: 'critical', re: /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/i, msg: 'Prompt-injection phrase in tool description' },
  { id: 'TP002', sev: 'high', re: /<\s*(important|system|secret|instructions?)\s*>/i, msg: 'Hidden instruction tag in tool description' },
  { id: 'TP003', sev: 'high', re: /(do not|don't|never) (tell|inform|mention|reveal)[^.]{0,40}(user|human)/i, msg: 'Asks the model to hide behaviour from the user' },
  { id: 'TP004', sev: 'high', re: /(~\/\.ssh|id_rsa|\.aws\/credentials|\.env\b|\.npmrc|keychain|wallet\.dat)/i, msg: 'References credential files' },
  { id: 'TP005', sev: 'medium', re: /https?:\/\/(?!localhost|127\.0\.0\.1)[^\s"')]+/i, msg: 'Embeds an external URL (possible exfiltration target)' },
  { id: 'TP006', sev: 'high', re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/, msg: 'Invisible / bidi unicode characters' },
  { id: 'TP007', sev: 'medium', re: /\b(rm -rf|drop table|git push --force|chmod 777|curl [^|]*\|\s*(ba)?sh)\b/i, msg: 'Destructive command in tool description' },
  { id: 'TP008', sev: 'medium', re: /(before|instead of) (using|calling) (any|other|the) tools?/i, msg: 'Tool tries to shadow or reorder other tools' },
];

function loadMcpscan(requireFn = require) {
  for (const name of ['@kurtfrancisco/argus', '@kurtfrancisco/mcpscan']) { // unscoped names are NOT trusted (different owners on npm)
    try { const m = requireFn(name); if (m && typeof m.checkToolDescription === 'function') return { name, mod: m }; } catch { /* absent */ }
  }
  return null;
}

function vetTools(tools, cfg = {}, { requireFn } = {}) {
  const opts = cfg.vet || {};
  const blockOn = SEV[opts.blockOn || 'high'];
  const list = Array.isArray(tools) ? tools : (tools && Array.isArray(tools.tools) ? tools.tools : []);
  const scanner = opts.mcpscan === 'off' ? null : loadMcpscan(requireFn);
  const results = list.map(t => {
    const name = String(t && t.name || '(unnamed)');
    const text = [t && t.description || '', JSON.stringify((t && (t.inputSchema || t.input_schema)) || {})].join('\n');
    const findings = RULES.filter(r => r.re.test(text)).map(r => ({ rule: r.id, severity: r.sev, message: r.msg, source: 'builtin' }));
    if (scanner) {
      try {
        for (const f of scanner.mod.checkToolDescription(t, { file: name }) || []) findings.push({ rule: f.ruleId || f.rule || f.id, title: f.title, evidence: f.evidence, severity: String(f.severity || 'medium').toLowerCase(), message: f.message, source: scanner.name });
      } catch (e) { findings.push({ rule: 'SCAN_ERR', severity: 'info', message: `mcpscan error: ${e.message}`, source: scanner.name }); }
    }
    const worst = findings.reduce((m, f) => Math.max(m, SEV[f.severity] ?? 2), -1);
    return { tool: name, findings, blocked: worst >= blockOn };
  });
  const required = opts.mcpscan === 'required' && !scanner;
  return {
    ok: !required && results.every(r => !r.blocked),
    scanner: scanner ? scanner.name : 'builtin',
    blockOn: opts.blockOn || 'high',
    allowedTools: results.filter(r => !r.blocked).map(r => r.tool),
    blockedTools: results.filter(r => r.blocked).map(r => r.tool),
    results,
    notes: required ? ['vet.mcpscan=required but @kurtfrancisco/mcpscan is not installed.'] : [],
  };
}

module.exports = { vetTools, RULES, loadMcpscan, SEV };
