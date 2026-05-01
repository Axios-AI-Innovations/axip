#!/usr/bin/env node
/**
 * Verify every `z.object({...})` in MCP tool schemas is followed by
 * `.strict()` (rejects unknown keys), `.passthrough()` (explicit
 * forward-compat), OR an inline `// strict-ok: <reason>` annotation.
 *
 * Replaces the line-bound grep guard that was previously in
 * `.github/workflows/mcp-server-security.yml`. The grep guard was
 * fundamentally broken: it matched `z.object({` on its own line and
 * never saw `.strict()` 5-10 lines later, so even correctly-hardened
 * schemas tripped the check.
 *
 * Algorithm: per file, find every `z.object(` occurrence, then check
 * whether the SAME LINE has a `strict-ok:` annotation OR the next 30
 * lines (i.e. through the matching `})`) contain `.strict()` or
 * `.passthrough()`.
 *
 * Exit 0 on clean, 1 on any unhardened schema (with line refs).
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = join(__dirname, '..');

const TARGET_GLOBS = ['src/tools.js', 'src/tools'];
const LOOKAHEAD_LINES = 30;
const ALLOWED_TERMINATORS = /\.strict\(\)|\.passthrough\(\)/;

function collectFiles() {
  const files = [];
  for (const target of TARGET_GLOBS) {
    const path = join(PKG_ROOT, target);
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (stat.isFile() && path.endsWith('.js')) {
      files.push(path);
    } else if (stat.isDirectory()) {
      for (const f of readdirSync(path)) {
        if (f.endsWith('.js')) files.push(join(path, f));
      }
    }
  }
  return files;
}

function checkFile(path) {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n');
  const failures = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/z\.object\(/.test(line)) continue;
    if (/strict-ok:/.test(line)) continue; // explicit allow on this line

    // Look ahead up to LOOKAHEAD_LINES for .strict() or .passthrough()
    const window = lines.slice(i, Math.min(i + LOOKAHEAD_LINES, lines.length)).join('\n');
    if (ALLOWED_TERMINATORS.test(window)) continue;

    // Also accept strict-ok: anywhere in the lookahead (covers
    // multi-line schema definitions that put the comment before the
    // `.passthrough()` call).
    if (/strict-ok:/.test(window)) continue;

    failures.push({ file: path.replace(PKG_ROOT + '/', ''), line: i + 1, content: line.trim() });
  }
  return failures;
}

function main() {
  const files = collectFiles();
  if (files.length === 0) {
    console.error('::error::No tool schema files found under', TARGET_GLOBS.join(', '));
    process.exit(2);
  }

  const allFailures = [];
  for (const f of files) allFailures.push(...checkFile(f));

  if (allFailures.length > 0) {
    console.error('::error::Found z.object() without .strict() / .passthrough() / strict-ok: annotation:');
    for (const f of allFailures) {
      console.error(`  ${f.file}:${f.line}  ${f.content}`);
    }
    console.error('');
    console.error('Fix by appending .strict() (preferred), .passthrough() (forward-compat output schemas only),');
    console.error('or an inline `// strict-ok: <reason>` comment on the same line.');
    process.exit(1);
  }

  console.log(`OK: ${files.length} file(s) scanned, all z.object() schemas hardened.`);
  process.exit(0);
}

main();
