'use strict';
/**
 * Plan -> build -> review orchestration with a spec gate before handoff, tool vetting,
 * hard budget stops and a per-run log. State: <stateDir>/runs/<id>/run.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('./config');
const { Budget, BudgetExceeded, estimateTokens, costOf } = require('./budget');
const { checkSpec } = require('./specgate');
const { vetTools } = require('./vet');
const { Logger } = require('./log');
const providers = require('./providers');

const TERMINAL = new Set(['approved', 'needs_human', 'blocked_spec', 'blocked_tools', 'stopped_budget', 'failed', 'cancelled']);

function briefFor(role, run) {
  const tools = run.tools.allowed.length ? `\nVetted tools you may use: ${run.tools.allowed.join(', ')}\n` : '';
  if (role === 'plan') return `You are the PLANNER. Do not write code. Produce a short, numbered implementation plan that satisfies every acceptance criterion, names the files to touch, and lists risks.\n\n# Spec\n${run.spec}\n`;
  if (role === 'build') {
    const fb = run.reviews.length ? `\n# Reviewer feedback to address (round ${run.round})\n${run.reviews[run.reviews.length - 1].output}\n` : '';
    return `You are the BUILDER. Implement the plan below exactly; stay inside the spec's scope. Do not run destructive commands (no force-push, no rm -rf, no publishing). Finish with a build report: changed files, tests run and their results.\n${tools}\n# Spec\n${run.spec}\n\n# Plan\n${run.plan || '(none)'}\n${fb}`;
  }
  return `You are the REVIEWER. Check the build against EACH acceptance criterion and say pass/fail with evidence. End with exactly one line: "VERDICT: APPROVE" or "VERDICT: CHANGES" followed by the required changes.\n\n# Acceptance criteria\n${run.gate.acceptance.map((a, i) => `${i + 1}. ${a}`).join('\n') || '(see spec)'}\n\n# Spec\n${run.spec}\n\n# Build report\n${run.builds[run.builds.length - 1] ? run.builds[run.builds.length - 1].output : '(none)'}\n`;
}

function parseVerdict(text) {
  const m = String(text).match(/VERDICT:\s*(APPROVE|APPROVED|CHANGES|REJECT)/i);
  if (!m) return 'unknown';
  return /^approve/i.test(m[1]) ? 'approve' : 'changes';
}

class Orchestrator {
  constructor(projectRoot = process.cwd(), opts = {}) {
    this.cfg = opts.cfg || loadConfig(projectRoot, opts.overrides || {});
    this.now = opts.now || (() => new Date());
    this.deps = opts.deps || {};
    this.budget = new Budget(this.cfg, { now: this.now });
    this.log = new Logger(this.cfg.stateDirAbs, { echo: !!opts.echo, now: this.now });
  }
  runDir(id) { return path.join(this.cfg.stateDirAbs, 'runs', id); }
  save(run) { run.updatedAt = this.now().toISOString(); fs.mkdirSync(this.runDir(run.id), { recursive: true }); fs.writeFileSync(path.join(this.runDir(run.id), 'run.json'), JSON.stringify(run, null, 2)); return run; }
  get(id) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('invalid run id');
    const f = path.join(this.runDir(id), 'run.json');
    if (!fs.existsSync(f)) throw new Error(`unknown run ${id}`);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  list() {
    const d = path.join(this.cfg.stateDirAbs, 'runs');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter(x => fs.existsSync(path.join(d, x, 'run.json'))).map(x => { const r = this.get(x); return { id: r.id, title: r.title, status: r.status, round: r.round, createdAt: r.createdAt, usage: this.budget.runTotals(r.id) }; }).sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  }

  async start({ spec, title, tools = [], specgateChange }) {
    if (!spec || typeof spec !== 'string') throw new Error('spec (markdown string) is required');
    const id = `run_${this.now().toISOString().replace(/[-:T]/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`;
    const gate = await checkSpec(spec, this.cfg, { ...this.deps, change: specgateChange });
    const vet = vetTools(tools, this.cfg, this.deps);
    const run = { id, title: title || (spec.match(/^#\s+(.+)$/m) || [, 'untitled'])[1].trim(), spec, createdAt: this.now().toISOString(), status: 'planning', next: 'plan', round: 0,
      gate, tools: { allowed: vet.allowedTools, blocked: vet.blockedTools, scanner: vet.scanner, results: vet.results }, plan: null, builds: [], reviews: [], steps: [] };
    this.log.info('run.created', { title: run.title, specScore: gate.score, specPass: gate.pass, toolsAllowed: vet.allowedTools.length, toolsBlocked: vet.blockedTools.length }, id);
    if (!gate.pass) { run.status = 'blocked_spec'; run.next = null; this.log.warn('spec.blocked', { score: gate.score, minScore: gate.minScore, missing: gate.missing.map(m => m.section).join(',') }, id); }
    else if (!vet.ok) { run.status = 'blocked_tools'; run.next = null; this.log.warn('tools.blocked', { blocked: vet.blockedTools.join(','), notes: vet.notes.join(' ') }, id); }
    return this.save(run);
  }

  /** What the next step is, with its brief. Host-provider steps are done by the calling agent. */
  next(id) {
    const run = this.get(id);
    if (TERMINAL.has(run.status) || !run.next) return { runId: id, status: run.status, done: true };
    const roleCfg = this.cfg.roles[run.next];
    return { runId: id, status: run.status, done: false, role: run.next, round: run.round, provider: roleCfg.provider, model: roleCfg.model, brief: briefFor(run.next, run), budget: this.budget.summary(id) };
  }

  preflight(run, role, brief) {
    const rc = this.cfg.roles[role];
    const inTok = estimateTokens(brief); const outTok = rc.maxOutputTokens || 4000;
    const est = { usd: costOf(rc.pricing, inTok, outTok), tokens: inTok + outTok };
    this.budget.check(run.id, est);
    return est;
  }

  stopForBudget(run, err) {
    run.status = 'stopped_budget'; run.next = null; run.stopReason = err.message;
    this.log.error('budget.stop', { scope: err.scope, kind: err.kind, used: err.used, limit: err.limit }, run.id);
    return this.save(run);
  }

  /** Record a step's output (from the host or a provider) and advance the state machine. */
  submit(id, role, { output, inputTokens, outputTokens, model } = {}) {
    const run = this.get(id);
    if (TERMINAL.has(run.status)) throw new Error(`run ${id} is ${run.status}`);
    if (role !== run.next) throw new Error(`expected a "${run.next}" result, got "${role}"`);
    if (typeof output !== 'string' || !output.trim()) throw new Error('output is required');
    const rc = this.cfg.roles[role];
    const brief = briefFor(role, run);
    const estimated = inputTokens == null || outputTokens == null;
    const inTok = inputTokens ?? estimateTokens(brief); const outTok = outputTokens ?? estimateTokens(output);
    const usd = costOf(rc.pricing, inTok, outTok);
    this.budget.record({ runId: id, role, model: model || rc.model, inputTokens: inTok, outputTokens: outTok, usd, estimated });
    run.steps.push({ role, round: run.round, at: this.now().toISOString(), model: model || rc.model, inputTokens: inTok, outputTokens: outTok, usd, estimated });
    this.log.info('step.done', { role, round: run.round, model: model || rc.model, tokens: inTok + outTok, usd: usd.toFixed(4), estimated }, id);

    if (role === 'plan') { run.plan = output; run.next = 'build'; run.status = 'building'; }
    else if (role === 'build') { run.builds.push({ round: run.round, output }); run.next = 'review'; run.status = 'reviewing'; }
    else {
      const verdict = parseVerdict(output);
      run.reviews.push({ round: run.round, output, verdict });
      this.log.info('review.verdict', { verdict, round: run.round }, id);
      if (verdict === 'approve') { run.status = 'approved'; run.next = null; }
      else if (verdict === 'unknown' || run.round + 1 >= Math.max(1, this.cfg.review.maxRounds || 1)) {
        run.status = 'needs_human'; run.next = null; run.stopReason = verdict === 'unknown' ? 'reviewer gave no VERDICT line' : `still changes requested after ${run.round + 1} review round(s)`;
      } else { run.round += 1; run.next = 'build'; run.status = 'building'; }
    }
    try { this.budget.enforce(id); } catch (e) { if (e instanceof BudgetExceeded && !TERMINAL.has(run.status)) return this.stopForBudget(run, e); if (!(e instanceof BudgetExceeded)) throw e; }
    return this.save(run);
  }

  /** Execute every non-host step server-side until done or a host step is reached. */
  async auto(id, { maxSteps = 20 } = {}) {
    let run = this.get(id);
    for (let i = 0; i < maxSteps && run.next && !TERMINAL.has(run.status); i++) {
      const role = run.next; const rc = this.cfg.roles[role];
      if (rc.provider === 'host') return { run, waitingFor: this.next(id) };
      const brief = briefFor(role, run);
      try { this.preflight(run, role, brief); } catch (e) { if (e instanceof BudgetExceeded) return { run: this.stopForBudget(run, e) }; throw e; }
      this.log.info('step.start', { role, round: run.round, provider: rc.provider, model: rc.model }, id);
      let res;
      try { res = providers.execute(role, rc, brief, this.cfg, this.deps); }
      catch (e) { run.status = 'failed'; run.next = null; run.stopReason = e.message; this.log.error('step.failed', { role, error: e.message }, id); return { run: this.save(run) }; }
      run = this.submit(id, role, { output: res.output, ...(res.usage || {}), model: rc.model });
    }
    return { run };
  }

  cancel(id, reason = 'cancelled') { const run = this.get(id); if (TERMINAL.has(run.status)) return run; run.status = 'cancelled'; run.next = null; run.stopReason = reason; this.log.warn('run.cancelled', { reason }, id); return this.save(run); }
}

module.exports = { Orchestrator, briefFor, parseVerdict, TERMINAL };
