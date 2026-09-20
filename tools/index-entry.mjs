#!/usr/bin/env node
// Prints the registry/official.json entry for a plugin folder, pinned to its current commit.
//   node tools/index-entry.mjs ../plugins/clickup --publisher promptops --publisher-name PromptOps --verified
// The folder must be a git repository whose HEAD is pushed: the app downloads the bundle
// from GitHub at that commit and refuses it if the hash differs.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { sha256, validateManifest } from '../playground/lib/policy.mjs';

const args = process.argv.slice(2);
const dir = resolve(process.cwd(), args[0] ?? '.');
const flag = (name, fallback = null) => { const i = args.indexOf('--' + name); return i === -1 ? fallback : args[i + 1]; };
const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

const manifest = JSON.parse(await readFile(join(dir, 'promptops-plugin.json'), 'utf8'));
const { errors } = validateManifest(manifest);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (git('status', '--porcelain')) { console.error('Commit your work first: the entry pins a commit.'); process.exit(1); }

const bundle = await readFile(join(dir, manifest.entry));
const repo = manifest.repository ?? git('remote', 'get-url', 'origin').replace(/\.git$/, '');
const [handle, slug] = manifest.id.split('.');
console.log(JSON.stringify({
  plugin_id: manifest.id, slug, name: manifest.name, category: manifest.category, description: manifest.description ?? null,
  repo_url: repo, status: 'published', version: manifest.version, commit_sha: git('rev-parse', 'HEAD'), bundle_sha256: sha256(bundle),
  source_dir: null, manifest,
  publisher: { handle: flag('publisher', handle), display_name: flag('publisher-name', handle), kind: flag('kind', 'team'), verified: args.includes('--verified') },
  updated_at: new Date(Number(git('log', '-1', '--format=%ct')) * 1000).toISOString(),
}, null, 2));
