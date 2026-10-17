'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const lic = require('../src/license');

function makeKey(payload) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
  const msg = Buffer.from(JSON.stringify(payload));
  const sig = crypto.sign(null, msg, privateKey);
  const b = x => x.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { key: `SKS2-${b(msg)}.${b(sig)}`, pubHex };
}
test('product id and shared public key', () => {
  assert.equal(lic.PRODUCT, 'codex-on-adderall-pro');
  assert.equal(lic.ENV_VAR, 'COA_LICENSE_KEY');
  assert.equal(lic.PUBLIC_KEY_HEX, '3dbbb56b1323d05f19a12b5a62cef225cd915388e68922c06698b0f1f327af8e');
});
test('valid key for this product verifies; other product and tampering fail', () => {
  const p = { d: '2026-10-17', eh: lic.emailHash('a@b.c'), oid: 'o1', p: 'codex-on-adderall-pro', v: 2 };
  const { key, pubHex } = makeKey(p);
  assert.equal(lic.validate(key, pubHex), true);
  assert.equal(lic.validate(key), false); // signed by a test key, not the real one
  const other = makeKey({ ...p, p: 'leadwright-pro' });
  assert.equal(lic.validate(other.key, other.pubHex), false);
  assert.equal(lic.validate(key.slice(0, -3) + 'AAA', pubHex), false);
  assert.equal(lic.validate('garbage'), false);
});
test('requirePro throws without key, dev flag bypasses', () => {
  const save = { ...process.env }; delete process.env.COA_LICENSE_KEY; delete process.env.COA_LICENSE_DEV;
  assert.throws(() => lic.requirePro(), /\$11/);
  process.env.COA_LICENSE_DEV = '1'; assert.ok(lic.requirePro());
  process.env = save;
});
