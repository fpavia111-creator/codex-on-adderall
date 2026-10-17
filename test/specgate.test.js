'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkSpec, builtinCheck, acceptanceItems } = require('../src/specgate');
const { GOOD_SPEC, noReq } = require('./helpers');

test('good spec passes with full score', () => {
  const r = builtinCheck(GOOD_SPEC);
  assert.equal(r.pass, true); assert.equal(r.score, 100); assert.equal(r.acceptance.length, 3);
});
test('vague one-liner fails and lists missing sections', () => {
  const r = builtinCheck('make the app better and faster');
  assert.equal(r.pass, false);
  assert.ok(r.missing.some(m => m.section === 'acceptance'));
  assert.ok(r.notes.some(n => /short/.test(n)));
});
test('missing acceptance fails even with a high score', () => {
  const spec = GOOD_SPEC.replace(/## Acceptance criteria[\s\S]*?## Out/, '## Out');
  assert.equal(builtinCheck(spec, { minScore: 10 }).pass, false);
});
test('vague acceptance items and TBD are penalised', () => {
  const spec = GOOD_SPEC.replace('- [ ] Exit code', '- [ ] it is fast etc\n- [ ] Exit code') + '\nTBD';
  const r = builtinCheck(spec);
  assert.ok(r.score < 100); assert.ok(r.notes.some(n => /Vague/.test(n))); assert.ok(r.notes.some(n => /TBD/.test(n)));
});
test('acceptanceItems parses checklist', () => { assert.equal(acceptanceItems(GOOD_SPEC)[1].startsWith('Without'), true); });
const fakeSg = (codes) => ({
  resolveFn: n => { if (n === '@kurtfrancisco/specgate/package.json') return require('path').join(__dirname, 'fixtures', 'fake-specgate', 'package.json'); throw new Error('x'); },
  specgateSpawn: (bin, args) => { const cmd = args[1]; return { status: codes[cmd], stdout: `${cmd} output`, stderr: '' }; },
});
test('specgate CLI: validate+status pass -> gate passes, records what was called', async () => {
  const calls = []; const d = fakeSg({ validate: 0, status: 0 }); const spawn = d.specgateSpawn;
  d.specgateSpawn = (b, a, o) => { calls.push(a); assert.equal(o.shell, false); return spawn(b, a, o); };
  const r = await checkSpec(GOOD_SPEC, { projectRoot: '/proj', specGate: { minScore: 70, external: 'auto' } }, { ...d, change: 'add-x' });
  assert.equal(r.pass, true); assert.equal(r.external.engine, '@kurtfrancisco/specgate');
  assert.deepEqual(calls.map(a => a.slice(1)), [['validate', 'add-x', '--root', '/proj'], ['status', 'add-x', '--root', '/proj']]);
  assert.match(calls[0][0], /fake-specgate[\\/]cli\.js$/);
});
test('specgate CLI: missing human sign-off vetoes', async () => {
  const r = await checkSpec(GOOD_SPEC, { specGate: { minScore: 70 } }, { ...fakeSg({ validate: 0, status: 1 }), change: 'add-x' });
  assert.equal(r.pass, false); assert.ok(r.notes.some(n => /specgate approve add-x/.test(n)));
});
test('specgate CLI: invalid change id rejected without spawning', async () => {
  const r = await checkSpec(GOOD_SPEC, {}, { ...fakeSg({}), specgateSpawn: () => { throw new Error('spawned'); }, change: '../x' });
  assert.equal(r.pass, false);
});
test('specgate installed but no change id: builtin result, noted', async () => {
  const r = await checkSpec(GOOD_SPEC, { specGate: { external: 'auto' } }, fakeSg({}));
  assert.equal(r.pass, true); assert.equal(r.external.used, false);
  const req = await checkSpec(GOOD_SPEC, { specGate: { external: 'required' } }, fakeSg({}));
  assert.equal(req.pass, false);
});
test('change id given but specgate absent fails closed', async () => {
  const r = await checkSpec(GOOD_SPEC, {}, { resolveFn: noReq, change: 'add-x' });
  assert.equal(r.pass, false); assert.ok(r.notes.some(n => /not installed/.test(n)));
});
test('external=required without the package fails', async () => {
  const r = await checkSpec(GOOD_SPEC, { specGate: { minScore: 70, external: 'required' } }, { resolveFn: noReq });
  assert.equal(r.pass, false);
});
test('external=off ignores the package', async () => {
  const r = await checkSpec(GOOD_SPEC, { specGate: { external: 'off' } }, { ...fakeSg({ validate: 1, status: 1 }), change: 'add-x' });
  assert.equal(r.pass, true);
});
