#!/usr/bin/env node
// PromptOps plugin playground. Zero dependencies: Node 18+ only.
//
//   node playground/server.mjs                  all templates
//   node playground/server.mjs --plugin ../my-plugin   plus your own folder
//
// It serves the graphical test page and plays the role of the PromptOps broker,
// applying the same rules as the real desktop runtime. It binds to 127.0.0.1 only.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { lookup } from 'node:dns/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_REQUEST_HEADERS, RESPONSE_HEADERS, isForbiddenIp, resolveUrl, scanSource, scrubSecrets, sha256, substituteSecrets, validDocsPath, validateManifest,
} from './lib/policy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TEMPLATES = join(ROOT, 'templates');
const MANIFEST = 'promptops-plugin.json';
const MAX_BODY = 2_000_000;

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 4173;
const custom = new Map(); // name -> absolute dir
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--plugin' && args[i + 1]) {
    const dir = resolve(process.cwd(), args[i + 1]);
    custom.set('local:' + basename(dir), dir);
  }
}

const storage = new Map(); // plugin dir name -> { key: value }

async function pluginDirs() {
  const out = new Map(custom);
  for (const name of await readdir(TEMPLATES).catch(() => [])) {
    if ((await stat(join(TEMPLATES, name))).isDirectory()) out.set(name, join(TEMPLATES, name));
  }
  return out;
}

async function loadPlugin(name) {
  const dir = (await pluginDirs()).get(name);
  if (!dir) throw new Error('unknown plugin folder: ' + name);
  const manifest = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8'));
  const validation = validateManifest(manifest);
  let bundle = '';
  let bundleSha256 = null;
  const findings = [];
  if (!validation.errors.length) {
    const raw = await readFile(join(dir, manifest.entry)).catch(() => null);
    if (!raw) validation.errors.push(`The bundle \`${manifest.entry}\` does not exist.`);
    else if (raw.length > MAX_BODY) validation.errors.push('The bundle is over the 2 MB limit.');
    else {
      bundle = raw.toString('utf8');
      bundleSha256 = sha256(raw);
      findings.push(...scanSource(manifest.entry, bundle, validation.hosts));
    }
  }
  const fixtures = JSON.parse(await readFile(join(dir, 'fixtures.json'), 'utf8').catch(() => '{"http":[]}'));
  const extras = {};
  for (const skill of manifest.contributes?.skills ?? []) {
    if (typeof skill.file === 'string' && !skill.file.includes('..')) {
      extras[skill.file] = await readFile(join(dir, skill.file), 'utf8').catch(() => null);
    }
  }
  return { name, dir, manifest, bundle, bundleSha256, validation, findings, fixtures, extras };
}

const glob = (pattern) => new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

async function httpFetch(plugin, params, mode, secrets) {
  const { url, host, audit } = resolveUrl(plugin.manifest, params.url, secrets);
  const method = String(params.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) throw Object.assign(new Error('HTTP method not allowed'), { audit });

  const headers = {};
  for (const [name, value] of Object.entries(params.headers ?? {})) {
    const lower = name.toLowerCase();
    if (FORBIDDEN_REQUEST_HEADERS.includes(lower) || lower.startsWith('sec-') || lower.startsWith('proxy-')) {
      throw Object.assign(new Error(`header \`${name}\` cannot be set by a plugin`), { audit });
    }
    if (String(value).includes('{{secret:') && !plugin.manifest.permissions.includes('secrets')) {
      throw Object.assign(new Error('permission `secrets` is not granted to this plugin'), { audit });
    }
    try { headers[name] = substituteSecrets(value, secrets); } catch (e) { throw Object.assign(e, { audit }); }
  }
  if (typeof params.body === 'string' && params.body.includes('{{secret:')) {
    throw Object.assign(new Error('secrets are allowed in headers and in the URL path or query only'), { audit });
  }

  if (mode === 'fixtures') {
    const hit = (plugin.fixtures.http ?? []).find((f) => (f.method ?? 'GET').toUpperCase() === method && glob(f.url).test(params.url));
    if (!hit) throw Object.assign(new Error(`no fixture for ${method} ${params.url}. Add one to fixtures.json or switch to Live.`), { audit });
    const body = typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body ?? null);
    return { audit, result: { status: hit.status ?? 200, ok: (hit.status ?? 200) < 300, headers: { 'content-type': 'application/json', ...(hit.headers ?? {}) }, body } };
  }

  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isForbiddenIp(a.address))) throw Object.assign(new Error('the host resolves to an internal or reserved address'), { audit });
  const res = await fetch(url, {
    method, headers: { 'user-agent': `PromptOps-Plugin-Playground (${plugin.manifest.id})`, ...headers },
    body: ['GET', 'HEAD'].includes(method) ? undefined : params.body, redirect: 'manual', signal: AbortSignal.timeout(20000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BODY) throw Object.assign(new Error('response over the size limit'), { audit });
  const outHeaders = {};
  for (const h of RESPONSE_HEADERS) if (res.headers.has(h)) outHeaders[h] = scrubSecrets(res.headers.get(h), secrets);
  return { audit, result: { status: res.status, ok: res.ok, headers: outHeaders, body: scrubSecrets(buf.toString('utf8'), secrets) } };
}

/** The repository of the playground comes from fixtures.json: there is no real folder behind it. */
export const PLAYGROUND_REPO = 'repo_playground';
const repoFixture = (plugin, params) => {
  if (params.repo !== PLAYGROUND_REPO) throw new Error('repository not granted to this plugin: the person picks it on the page');
  return plugin.fixtures.git ?? { name: 'demo-repo', branch: 'main', status: { branch: 'main', files: [] }, log: [], diff: '' };
};

/**
 * Same isolation as PromptOps: no tools, no MCP servers, no skills, an empty working folder.
 * No shell is involved, so the empty `--tools` value reaches the CLI as it is.
 */
async function runClaude(prompt, model) {
  const cwd = await mkdtemp(join(tmpdir(), 'po-playground-ai-'));
  const args = ['-p', '--output-format', 'text', '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'];
  if (model) args.push('--model', model);
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('the model did not answer in time')); }, 300_000);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', () => { clearTimeout(timer); reject(new Error('`claude` was not found on this machine. Use Fixtures mode, or install Claude Code.')); });
      child.on('close', (code) => { clearTimeout(timer); code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error(err.trim().slice(0, 300) || 'the model returned nothing')); });
      child.stdin.end(prompt);
    });
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

async function broker(body) {
  const plugin = await loadPlugin(body.plugin);
  if (body.mode === 'fixtures') {
    // Offline testing: every declared secret counts as set, with a dummy value that never leaves this machine.
    body.secrets = { ...(body.secrets ?? {}) };
    for (const f of plugin.manifest.config?.fields ?? []) if (f.type === 'secret' && !body.secrets[f.key]) body.secrets[f.key] = 'fixture-secret';
  }
  const perms = plugin.manifest.permissions ?? [];
  const need = (p) => { if (!perms.includes(p)) throw new Error(`permission \`${p}\` is not granted to this plugin`); };
  const params = body.params ?? {};
  const store = storage.get(plugin.name) ?? {};
  storage.set(plugin.name, store);

  switch (body.method) {
    case 'http.fetch': return httpFetch(plugin, params, body.mode, body.secrets ?? {});
    case 'storage.get': need('storage'); return { result: store[params.key] ?? null };
    case 'storage.set':
      need('storage');
      if (params.value === null || params.value === undefined) delete store[params.key]; else store[params.key] = params.value;
      if (JSON.stringify(store).length > 1_000_000) throw new Error('plugin storage quota exceeded');
      return { result: true };
    case 'config.get': return { result: { ...(body.config ?? {}), __secretsSet: Object.keys(body.secrets ?? {}).filter((k) => body.secrets[k]) } };
    case 'notify.toast': need('notify'); return { audit: 'toast', result: true, ui: { toast: String(params.message ?? '').slice(0, 300) } };
    case 'prompt.propose':
      need('prompt:propose');
      return { audit: 'proposal', result: true, ui: { proposal: { title: String(params.title ?? '').slice(0, 120), text: String(params.text ?? '').slice(0, 8000) } } };
    // ── Section `pages` ──
    case 'git.status': { need('git:read'); const r = repoFixture(plugin, params); return { audit: r.name, result: { files: [], total: (r.status?.files ?? []).length, truncated: false, ...r.status } }; }
    case 'git.log': { need('git:read'); const r = repoFixture(plugin, params); return { audit: r.name, result: (r.log ?? []).slice(0, Math.min(Math.max(Number(params.limit) || 20, 1), 100)) }; }
    case 'git.diff': { need('git:read'); const r = repoFixture(plugin, params); return { audit: r.name, result: { diff: String(r.diff ?? '').slice(0, 200_000), truncated: false } }; }
    case 'workspace.writeFile': {
      need('workspace:write');
      const r = repoFixture(plugin, params);
      if (!validDocsPath(params.path)) throw new Error('only `docs/` can be written, in .md, .markdown or .txt files');
      if (String(params.content ?? '').length > 500_000) throw new Error('content over the size limit');
      // The page asks the person first and sends `confirmed`. Without it the call is refused, as in PromptOps.
      if (body.confirmed !== true) throw new Error('user_denied: the person did not confirm');
      // The playground never touches a disk: it shows the file instead.
      return { audit: `${r.name}/${params.path}`, result: { path: params.path, repo: r.name, overwritten: false }, ui: { file: { path: `${r.name}/${params.path}`, content: String(params.content) } } };
    }
    case 'ai.generate': {
      need('ai:generate');
      const prompt = String(params.prompt ?? '').trim();
      if (!prompt) throw new Error('parameter `prompt` is missing');
      if (prompt.length > 200_000) throw new Error('prompt over the size limit');
      if (params.model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/.test(String(params.model))) throw new Error('model name is not valid');
      if (body.confirmed !== true) throw new Error('user_denied: the person did not confirm');
      const audit = `claude${params.model ? ' ' + params.model : ''} · ${prompt.length} chars`;
      if (body.mode === 'fixtures') {
        const hit = (plugin.fixtures.ai ?? []).find((f) => !f.match || prompt.includes(f.match));
        if (!hit) throw Object.assign(new Error('no `ai` fixture matches this prompt. Add one to fixtures.json or switch to Live.'), { audit });
        return { audit, result: { text: String(hit.text), truncated: false } };
      }
      return { audit, result: { text: (await runClaude(prompt, params.model)).slice(0, 200_000), truncated: false } };
    }
    // Speed measurements. In PromptOps the app owns the prompt and runs the CLIs: the plugin gets numbers only.
    // The playground never calls a model for this: numbers come from `benchmark` in fixtures.json, in both modes.
    case 'ai.benchmarkModels': need('ai:benchmark'); return { audit: 'models', result: { ok: true, data: plugin.fixtures.benchmark?.models ?? [], modes: [] } };
    case 'ai.benchmark': {
      need('ai:benchmark');
      const known = plugin.fixtures.benchmark?.models ?? [];
      const ids = [...new Set(Array.isArray(params.models) ? params.models.map(String) : [])];
      if (!ids.length || ids.length > 12) throw new Error('1 to 12 models per measurement');
      const unknown = ids.find((id) => !known.some((m) => m.id === id));
      if (unknown) throw new Error(`model \`${unknown.slice(0, 60)}\` is not in the catalog`);
      if (body.confirmed !== true) throw new Error('user_denied: the person did not confirm');
      const results = ids.map((id) => {
        const m = known.find((x) => x.id === id);
        const r = plugin.fixtures.benchmark?.results?.[id] ?? { error: 'no `benchmark.results` fixture for this model' };
        const base = { id, label: m.label, provider: m.provider, providerLabel: m.providerLabel, baseline: m.baseline ?? null, history: m.history ?? { runs: 0, medianTps: null, lastRunAt: null } };
        if (r.error) return { ...base, ok: false, error: String(r.error), classification: 'unknown' };
        const band = m.baseline?.expectedTps;
        const classification = !band ? 'unknown' : r.tokensPerSec < band.min ? 'below' : r.tokensPerSec > band.max ? 'above' : 'within';
        return { ...base, ok: true, tokensEstimated: false, samples: [], wallMs: (r.sampleMs ?? 0) * 3, ...r, classification };
      });
      return { audit: `${ids.length} model(s) · 3 runs each`, result: { results }, ui: { benchmark: { labels: results.map((r) => r.label) } } };
    }
    case 'pages.update': {
      const pageId = String(params.pageId ?? '');
      if (!(plugin.manifest.contributes?.pages ?? []).some((p) => p.id === pageId)) throw new Error('page not declared in the manifest');
      if (JSON.stringify(params.view ?? null).length > 256_000) throw new Error('view over the size limit');
      return { audit: pageId, result: true, ui: { pageUpdate: { pageId, view: params.view } } };
    }
    case 'log': return { audit: String(params.message ?? '').slice(0, 500), result: true };
    default: throw new Error(`method \`${body.method}\` is not offered by the runtime`);
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
// 'unsafe-inline' is needed because the sandboxed plugin iframe inherits this policy and runs inline.
// frame-src 'none' is the important one: it stops a plugin iframe from navigating itself away.
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'none'; base-uri 'none'; form-action 'none'";

const send = (res, status, type, body) => {
  res.writeHead(status, { 'Content-Type': type, 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
};
const json = (res, status, value) => send(res, status, 'application/json', JSON.stringify(value));

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    // Same-origin only: another web page must not be able to drive the broker.
    if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}` && req.headers.origin !== `http://localhost:${port}`) {
      return json(res, 403, { error: 'forbidden' });
    }
    if (url.pathname === '/api/templates') {
      const list = [];
      for (const name of (await pluginDirs()).keys()) {
        const p = await loadPlugin(name).catch((e) => ({ name, error: e.message }));
        list.push({ name, id: p.manifest?.id, title: p.manifest?.name, category: p.manifest?.category, error: p.error });
      }
      return json(res, 200, list);
    }
    if (url.pathname === '/api/plugin') {
      const p = await loadPlugin(url.searchParams.get('name'));
      const git = p.fixtures.git ?? {};
      return json(res, 200, { name: p.name, manifest: p.manifest, bundle: p.bundle, bundleSha256: p.bundleSha256, validation: p.validation, findings: p.findings, extras: p.extras,
        fixtureCount: (p.fixtures.http ?? []).length + (p.fixtures.ai ?? []).length + (p.fixtures.git ? 1 : 0) + Object.keys(p.fixtures.benchmark?.results ?? {}).length,
        repo: { name: String(git.name ?? 'demo-repo'), branch: String(git.branch ?? git.status?.branch ?? 'main') } });
    }
    if (url.pathname === '/api/broker' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      try {
        const out = await broker(body);
        return json(res, 200, { ok: true, result: out.result, audit: out.audit ?? null, ui: out.ui ?? null });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message, audit: e.audit ?? null });
      }
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[A-Za-z0-9_.-]+$/.test(file)) return send(res, 404, 'text/plain', 'not found');
    const data = await readFile(join(HERE, file)).catch(() => null);
    if (!data) return send(res, 404, 'text/plain', 'not found');
    send(res, 200, TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream', data);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`\n  PromptOps plugin playground\n  Open  http://127.0.0.1:${port}\n`);
  for (const [name, dir] of custom) console.log(`  Your plugin: ${name}  (${dir})`);
});
