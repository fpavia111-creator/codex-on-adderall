'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Budget, BudgetExceeded, costOf, estimateTokens, dayKey } = require('../src/budget');
const { loadConfig } = require('../src/config');
const { tmp } = require('./helpers');

test('costOf and estimateTokens', () => {
  assert.equal(costOf({ inputPerM: 10, outputPerM: 30 }, 1e6, 1e6), 40);
  assert.equal(estimateTokens('abcdefgh'), 2);
});
test('per-run usd hard stop', () => {
  const b = new Budget(loadConfig(tmp(), { budgets: { perRun: { usd: 1, tokens: 1e9 }, perDay: { usd: 100, tokens: 1e9 } } }));
  b.record({ runId: 'r1', role: 'plan', model: 'm', inputTokens: 10, outputTokens: 10, usd: 0.9 });
  assert.throws(() => b.check('r1', { usd: 0.2, tokens: 0 }), e => e instanceof BudgetExceeded && e.scope === 'perRun' && e.kind === 'usd');
  assert.ok(b.check('r2', { usd: 0.2, tokens: 0 }));
});
test('per-day token hard stop across runs; next day resets', () => {
  let now = new Date(2026, 9, 17, 12);
  const b = new Budget(loadConfig(tmp(), { budgets: { perRun: { usd: 100, tokens: 1e9 }, perDay: { usd: 100, tokens: 1000 } } }), { now: () => now });
  b.record({ runId: 'a', role: 'build', model: 'm', inputTokens: 600, outputTokens: 0, usd: 0 });
  b.record({ runId: 'b', role: 'build', model: 'm', inputTokens: 300, outputTokens: 0, usd: 0 });
  assert.throws(() => b.check('c', { usd: 0, tokens: 200 }), e => e.scope === 'perDay' && e.kind === 'tokens');
  now = new Date(2026, 9, 18, 9);
  assert.ok(b.check('c', { usd: 0, tokens: 200 }));
  assert.equal(dayKey(now), '2026-10-18');
});
test('config validation rejects bad values', () => {
  assert.throws(() => loadConfig(tmp(), { budgets: { perRun: { usd: -1 } } }), /non-negative/);
  assert.throws(() => loadConfig(tmp(), { roles: { plan: { provider: 'cloud' } } }), /provider/);
  assert.throws(() => loadConfig(tmp(), { roles: { plan: { provider: 'command' } } }), /command/);
});
