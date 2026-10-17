'use strict';
/**
 * Per-run and per-day cost/token budgets with HARD stops.
 * Ledger: <stateDir>/usage.jsonl, one line per model call. Day boundaries use local time.
 */
const fs = require('fs');
const path = require('path');

class BudgetExceeded extends Error {
  constructor(scope, kind, used, limit) {
    super(`budget exceeded: ${scope} ${kind} limit ${fmt(kind, limit)} (would reach ${fmt(kind, used)}). Run stopped; raise budgets.${scope}.${kind} in coa.config.json to continue.`);
    this.code = 'COA_BUDGET'; this.scope = scope; this.kind = kind; this.used = used; this.limit = limit;
  }
}
function fmt(kind, v) { return kind === 'usd' ? `$${Number(v).toFixed(4)}` : `${Math.round(v)} tokens`; }

function estimateTokens(text) { return Math.ceil(String(text || '').length / 4); }
function costOf(pricing = {}, inTok = 0, outTok = 0) {
  return ((pricing.inputPerM || 0) * inTok + (pricing.outputPerM || 0) * outTok) / 1e6;
}
function dayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

class Budget {
  constructor(cfg, { now = () => new Date() } = {}) {
    this.limits = cfg.budgets; this.now = now;
    this.file = path.join(cfg.stateDirAbs, 'usage.jsonl');
    fs.mkdirSync(cfg.stateDirAbs, { recursive: true });
  }
  entries() {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  totals(filter) {
    let usd = 0, tokens = 0, calls = 0;
    for (const e of this.entries()) if (filter(e)) { usd += e.usd; tokens += e.inputTokens + e.outputTokens; calls++; }
    return { usd, tokens, calls };
  }
  runTotals(runId) { return this.totals(e => e.runId === runId); }
  dayTotals(day = dayKey(this.now())) { return this.totals(e => e.day === day); }

  /** Throws BudgetExceeded if adding `est` ({usd,tokens}) would cross any limit. */
  check(runId, est = { usd: 0, tokens: 0 }) {
    const scopes = [['perRun', this.runTotals(runId)], ['perDay', this.dayTotals()]];
    for (const [scope, t] of scopes) {
      const lim = this.limits[scope] || {};
      if (lim.usd != null && t.usd + est.usd > lim.usd + 1e-12) throw new BudgetExceeded(scope, 'usd', t.usd + est.usd, lim.usd);
      if (lim.tokens != null && t.tokens + est.tokens > lim.tokens) throw new BudgetExceeded(scope, 'tokens', t.tokens + est.tokens, lim.tokens);
    }
    return true;
  }
  record({ runId, role, model, inputTokens, outputTokens, usd, estimated }) {
    const e = { ts: this.now().toISOString(), day: dayKey(this.now()), runId, role, model, inputTokens, outputTokens, usd, estimated: !!estimated };
    fs.appendFileSync(this.file, JSON.stringify(e) + '\n');
    return e;
  }
  /** After recording, enforce again so a single over-budget call still stops the run. */
  enforce(runId) { return this.check(runId, { usd: 0, tokens: 0 }); }
  summary(runId) {
    const day = this.dayTotals();
    const out = { today: { ...day, limit: this.limits.perDay }, limits: this.limits };
    if (runId) out.run = { ...this.runTotals(runId), limit: this.limits.perRun };
    return out;
  }
}

module.exports = { Budget, BudgetExceeded, estimateTokens, costOf, dayKey };
