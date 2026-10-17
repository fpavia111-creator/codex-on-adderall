'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'coa-')); }
const GOOD_SPEC = fs.readFileSync(path.join(__dirname, '..', 'examples', 'spec.md'), 'utf8');
const mockRoles = (extra = {}) => ({
  plan: { provider: 'mock', model: 'm-plan', pricing: { inputPerM: 10, outputPerM: 30 }, ...(extra.plan || {}) },
  build: { provider: 'mock', model: 'm-build', pricing: { inputPerM: 1, outputPerM: 2 }, ...(extra.build || {}) },
  review: { provider: 'mock', model: 'm-review', pricing: { inputPerM: 5, outputPerM: 15 }, ...(extra.review || {}) },
});
const noReq = () => { throw new Error('not installed'); };
module.exports = { tmp, GOOD_SPEC, mockRoles, noReq };
