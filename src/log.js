'use strict';
/** Clear logs: one JSONL file per run plus a global events file, with a human formatter. */
const fs = require('fs');
const path = require('path');

const SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|SKS2-[A-Za-z0-9_.-]{20,})/g;
function redact(s) { return String(s).replace(SECRET_RE, m => m.slice(0, 4) + '…[redacted]'); }

class Logger {
  constructor(dir, { echo = false, now = () => new Date() } = {}) {
    this.dir = dir; this.echo = echo; this.now = now;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(runId) { return runId ? path.join(this.dir, 'runs', runId, 'log.jsonl') : path.join(this.dir, 'events.jsonl'); }
  log(level, event, data = {}, runId = null) {
    const entry = { ts: this.now().toISOString(), level, event, runId, ...JSON.parse(redact(JSON.stringify(data))) };
    const f = this.file(runId);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(entry) + '\n');
    if (runId) fs.appendFileSync(this.file(null), JSON.stringify(entry) + '\n');
    if (this.echo) process.stderr.write(format(entry) + '\n');
    return entry;
  }
  info(e, d, r) { return this.log('info', e, d, r); }
  warn(e, d, r) { return this.log('warn', e, d, r); }
  error(e, d, r) { return this.log('error', e, d, r); }
  read(runId, limit = 200) {
    const f = this.file(runId);
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-limit);
  }
}

function format(e) {
  const { ts, level, event, runId, ...rest } = e;
  const bits = Object.entries(rest).filter(([, v]) => v !== undefined && typeof v !== 'object').map(([k, v]) => `${k}=${String(v).slice(0, 80)}`);
  return `${ts.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${runId ? '[' + runId + '] ' : ''}${event}${bits.length ? '  ' + bits.join(' ') : ''}`;
}

module.exports = { Logger, format, redact };
