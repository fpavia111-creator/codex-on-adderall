#!/usr/bin/env node
// Runs test/*.test.js with node --test. Lists files explicitly so it works the same on
// Node 18-24 and on Windows (where npm scripts get no shell glob expansion).
"use strict";
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const files = readdirSync("test").filter((f) => f.endsWith(".test.js")).sort().map((f) => join("test", f));
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
