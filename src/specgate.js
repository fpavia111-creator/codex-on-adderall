'use strict';
/**
 * Spec gate: no handoff to a builder until the spec is concrete enough to check.
 * Built-in offline scorer; optionally defers to @kurtfrancisco/specgate when installed
 * (specGate.external: "auto" uses it if present, "required" fails without it, "off" never).
 */
const VAGUE = ['etc', 'and so on', 'somehow', 'nice', 'better', 'fast', 'user-friendly', 'robust', 'intuitive', 'tbd', 'as needed', 'whatever', 'clean up', 'improve'];
const SECTIONS = [
  { key: 'goal', weight: 20, re: /^#{1,4}\s*(goal|objective|summary|problem)\b|^(goal|objective)\s*:/im, hint: 'Add a "Goal" section: one or two sentences on what changes and why.' },
  { key: 'acceptance', weight: 30, re: /^#{1,4}\s*(acceptance( criteria)?|done when|definition of done)\b|^(acceptance( criteria)?|done when)\s*:/im, hint: 'Add "Acceptance criteria" as a checklist of observable, testable outcomes.' },
  { key: 'scope', weight: 15, re: /^#{1,4}\s*(out of scope|non-goals|scope|constraints)\b|^(out of scope|non-goals|constraints)\s*:/im, hint: 'Add "Out of scope" / "Constraints" so the builder knows what not to touch.' },
  { key: 'tests', weight: 20, re: /^#{1,4}\s*(test(s| plan)?|verification|how to verify)\b|^(tests?|verification)\s*:/im, hint: 'Add a "Test plan": commands or steps that prove each criterion.' },
  { key: 'files', weight: 15, re: /(`[^`]+\.[a-z0-9]{1,6}`|\b[\w./-]+\/[\w.-]+\.[a-z0-9]{1,6}\b|^#{1,4}\s*(files|affected areas|context)\b)/im, hint: 'Name the files, modules or areas involved.' },
];

function acceptanceItems(text) {
  const m = text.match(/(acceptance( criteria)?|done when|definition of done)[^\n]*\n([\s\S]*?)(\n#{1,4}\s|\n[A-Z][\w ]{2,30}:\s*\n|$)/i);
  if (!m) return [];
  return m[3].split('\n').filter(l => /^\s*([-*+]|\d+[.)]|- \[[ x]\])\s+\S/.test(l)).map(l => l.replace(/^\s*([-*+]|\d+[.)])\s*(\[[ x]\]\s*)?/, '').trim());
}

function builtinCheck(spec, { minScore = 70 } = {}) {
  const text = String(spec || '');
  const missing = []; const notes = [];
  let score = 0;
  for (const s of SECTIONS) { if (s.re.test(text)) score += s.weight; else missing.push({ section: s.key, hint: s.hint }); }
  const items = acceptanceItems(text);
  if (SECTIONS[1].re.test(text) && items.length === 0) { score -= 15; notes.push('Acceptance section has no list items.'); }
  const vagueItems = items.filter(i => VAGUE.some(v => new RegExp(`\\b${v}\\b`, 'i').test(i)));
  if (vagueItems.length) { score -= 5 * vagueItems.length; notes.push(`Vague acceptance items: ${vagueItems.map(i => JSON.stringify(i)).join(', ')}`); }
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 40) { score -= 20; notes.push(`Spec is very short (${words} words).`); }
  if (/\b(TODO|TBD|\?\?\?)\b/.test(text)) { score -= 10; notes.push('Spec contains TODO/TBD placeholders.'); }
  score = Math.max(0, Math.min(100, score));
  return { pass: score >= minScore && !missing.some(m => m.section === 'acceptance'), score, minScore, acceptance: items, missing, notes, engine: 'builtin' };
}

/**
 * @kurtfrancisco/specgate (>=0.3) is an ESM CLI for OpenSpec changes with human sign-off; its package
 * entry runs the CLI, so we call its documented CLI (no shell, resolved bin, no npx/network):
 *   specgate validate <change> --root <projectRoot>   exit 0 = spec format valid (SHALL/MUST, scenarios, no TODOs)
 *   specgate status   <change> --root <projectRoot>   exit 0 = signed off by the required approvers
 * Used when a SpecGate change id is given (start_run.specgateChange or specGate.change).
 */
const path = require('path');
const { spawnSync } = require('child_process');
const PKG = '@kurtfrancisco/specgate';

function locateSpecgate(resolveFn = require.resolve) {
  try {
    const pj = resolveFn(`${PKG}/package.json`);
    const meta = JSON.parse(require('fs').readFileSync(pj, 'utf8'));
    const bin = typeof meta.bin === 'string' ? meta.bin : (meta.bin && meta.bin.specgate);
    if (!bin) return null;
    return { name: PKG, version: meta.version, bin: path.join(path.dirname(pj), bin) };
  } catch { return null; }
}
// Back-compat alias used by status/doctor.
const loadExternal = (resolveFn) => locateSpecgate(resolveFn);

function runSpecgate(sg, args, root, spawn = spawnSync) {
  const r = spawn(process.execPath, [sg.bin, ...args, '--root', root], { encoding: 'utf8', shell: false, timeout: 60000, env: { ...process.env, NO_COLOR: '1' } });
  if (r.error) return { code: -1, out: r.error.message };
  return { code: r.status, out: (String(r.stdout || '') + String(r.stderr || '')).trim() };
}

async function checkSpec(spec, cfg = {}, deps = {}) {
  const opts = cfg.specGate || {};
  const base = builtinCheck(spec, { minScore: opts.minScore ?? 70 });
  const change = deps.change || opts.change;
  if (opts.external === 'off') return base;
  if (change && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(change)) return { ...base, pass: false, notes: [...base.notes, `invalid SpecGate change id "${change}" (lowercase kebab-case)`] };
  const sg = locateSpecgate(deps.resolveFn);
  if (!sg) {
    if (opts.external === 'required' || change) return { ...base, pass: false, notes: [...base.notes, `${PKG} is not installed${change ? ` (needed to check change "${change}")` : ''}. npm i -D ${PKG}`] };
    return base;
  }
  if (!change) {
    if (opts.external === 'required') return { ...base, pass: false, external: { engine: PKG, version: sg.version }, notes: [...base.notes, 'specGate.external=required: pass a SpecGate change id (specgateChange) so its sign-off can be checked.'] };
    return { ...base, external: { engine: PKG, version: sg.version, used: false, note: 'installed; pass specgateChange to require its validation + human sign-off' } };
  }
  const root = cfg.projectRoot || process.cwd();
  const validate = runSpecgate(sg, ['validate', change], root, deps.specgateSpawn);
  const status = runSpecgate(sg, ['status', change], root, deps.specgateSpawn);
  const extPass = validate.code === 0 && status.code === 0;
  const notes = [...base.notes];
  if (validate.code !== 0) notes.push(`specgate validate ${change} failed: ${validate.out.split('\n').slice(0, 5).join(' | ')}`);
  if (status.code !== 0) notes.push(`specgate status ${change}: ${status.out.split('\n')[0]} (a human must run: specgate approve ${change})`);
  return { ...base, pass: base.pass && extPass, notes, engine: `builtin+${PKG}`,
    external: { engine: PKG, version: sg.version, change, pass: extPass, validate: { exit: validate.code, output: validate.out }, status: { exit: status.code, output: status.out } } };
}

module.exports = { checkSpec, builtinCheck, acceptanceItems, loadExternal, locateSpecgate, runSpecgate };
