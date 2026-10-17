# Add a --json flag to the export command

## Goal
Let scripts consume `export` output by adding a `--json` flag to `src/cli/export.js` that prints records as a JSON array instead of a table.

## Acceptance criteria
- [ ] `app export --json` prints a valid JSON array of records to stdout
- [ ] Without `--json`, the table output is byte-for-byte unchanged
- [ ] Exit code is 0 on success and 1 when the data file is missing

## Out of scope
- Changing the table format or adding other output formats

## Test plan
- `node --test test/export.test.js` covers both modes and the missing-file case
