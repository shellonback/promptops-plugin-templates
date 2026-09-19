#!/usr/bin/env node
// Checks a plugin folder the same way PromptOps does, and prints the values you need to submit it.
//   node tools/validate.mjs templates/tasks
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describePermission, scanSource, sha256, validateManifest } from '../playground/lib/policy.mjs';

const dir = resolve(process.cwd(), process.argv[2] ?? '.');
const fail = (msg) => { console.error('\n  ✗ ' + msg + '\n'); process.exit(1); };

const raw = await readFile(join(dir, 'promptops-plugin.json'), 'utf8').catch(() => fail(`No promptops-plugin.json in ${dir}`));
let manifest;
try { manifest = JSON.parse(raw); } catch (e) { fail('promptops-plugin.json is not valid JSON: ' + e.message); }

const { errors, warnings, hosts } = validateManifest(manifest);
const bundle = errors.length ? null : await readFile(join(dir, manifest.entry)).catch(() => null);
if (!errors.length && !bundle) errors.push(`The bundle \`${manifest.entry}\` does not exist.`);
if (bundle && bundle.length > 2_000_000) errors.push('The bundle is over the 2 MB limit.');

console.log(`\n  ${manifest.name ?? '?'}  (${manifest.id ?? '?'})  v${manifest.version ?? '?'}  section: ${manifest.category ?? '?'}\n`);
for (const e of errors) console.log('  ✗ ' + e);
for (const w of warnings) console.log('  ! ' + w);
if (errors.length) process.exit(1);

console.log('  Permissions the person will approve:');
for (const p of manifest.permissions) console.log('    · ' + describePermission(p));
if (!manifest.permissions.length) console.log('    · nothing outside the sandbox');

const findings = scanSource(manifest.entry, bundle.toString('utf8'), hosts);
console.log('\n  Reviewer scan:');
if (!findings.length) console.log('    ✓ nothing flagged');
for (const f of findings) console.log(`    ${f.severity === 'fail' ? '✗' : '!'} ${f.title}\n      ${f.file}:${f.line}  ${f.excerpt}`);

let commit = '(commit your work first)';
try { commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
console.log('\n  Values for "Submit for review" in PromptOps:');
console.log('    Version        ' + manifest.version);
console.log('    Commit SHA     ' + commit);
console.log('    Bundle SHA-256 ' + sha256(bundle));
console.log('    Manifest       paste promptops-plugin.json as it is\n');
process.exit(findings.some((f) => f.severity === 'fail') ? 1 : 0);
