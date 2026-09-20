// Same rules as the PromptOps desktop runtime (Rust) and the registry scanner (PHP).
// Keep the three in sync: a plugin that passes here must behave the same in the app.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const CATEGORIES = ['tasks', 'code', 'data', 'providers', 'agent', 'context', 'notify', 'pages'];

export const ALLOWED_PERMISSIONS = [
  'secrets', 'storage', 'notify', 'sessions:read', 'tasks:read', 'tasks:write', 'prompt:propose', 'agents:propose',
  // Section `pages` only. Each one goes through a choice or a confirmation by the person.
  'git:read', 'workspace:write', 'ai:generate',
];
/**
 * AI providers a plugin can say it works with (`providers` in the manifest). Optional.
 * It is a statement by the author, shown in the catalog: the first three as small icons.
 */
export const PROVIDERS = {
  'claude-code-cli': 'Claude Code', codex: 'Codex', 'gemini-cli': 'Gemini', antigravity: 'Antigravity', copilot: 'GitHub Copilot',
  cursor: 'Cursor', grok: 'Grok', hermes: 'Hermes', zai: 'Z.AI', kimi: 'Kimi', opencode: 'Opencode',
};
export const MAX_PROVIDERS = 11;

export const PAGES_ONLY_PERMISSIONS = ['git:read', 'workspace:write', 'ai:generate'];
export const MAX_MENU_PAGES = 3;

export const PERMISSION_TEXT = {
  secrets: 'Use the credentials you configure, without ever reading them',
  storage: 'Keep its own small local data',
  notify: 'Show notifications',
  'sessions:read': 'See the names and status of your sessions, not their content',
  'tasks:read': 'Read tasks of the project where it is active',
  'tasks:write': 'Create and update tasks of the project where it is active',
  'prompt:propose': 'Propose a prompt that you review before it is sent',
  'agents:propose': 'Propose starting an agent, which you confirm',
  'git:read': 'Read branch, changed files, commits and diff of a repository you pick on its page',
  'workspace:write': 'Write text files in the docs/ folder of that repository. You confirm every file',
  'ai:generate': 'Run a prompt on your own Claude, with no tools and no file access. You see and confirm every prompt',
};

export const describePermission = (p) => (p.startsWith('net:') ? `Connect to ${p.slice(4)} over HTTPS` : PERMISSION_TEXT[p] ?? p);

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const slugOk = (s) => /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/.test(s);
export const validPluginId = (id) => typeof id === 'string' && id.split('.').length === 2 && id.split('.').every(slugOk);

export const validRelPath = (p, ext) =>
  typeof p === 'string' && p.length <= 200 && !p.includes('..') && !p.startsWith('/') && !p.startsWith('.') &&
  /^[A-Za-z0-9_./-]+$/.test(p) && p.toLowerCase().endsWith('.' + ext);

/** Where `workspace.writeFile` may write: docs/<...>.md|markdown|txt, nothing hidden, nothing above. */
export const validDocsPath = (p) =>
  typeof p === 'string' && p.startsWith('docs/') && p.length > 5 && !p.split('/').some((seg) => !seg || seg.startsWith('.')) &&
  ['md', 'markdown', 'txt'].some((ext) => validRelPath(p, ext));

/** An icon becomes a CSS class in the app: only a well-formed Tabler name is accepted. */
export const validIcon = (icon) => typeof icon === 'string' && /^ti-[a-z0-9-]{2,45}$/.test(icon);

export function isPublicHostname(host) {
  host = String(host).toLowerCase();
  if (host.length < 4 || host.length > 253 || isIP(host)) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  const tld = labels.at(-1);
  if (!/^[a-z]{2,}$/.test(tld) || ['localhost', 'local', 'internal', 'lan', 'home', 'corp'].includes(tld)) return false;
  return labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l));
}

export function isForbiddenIp(ip) {
  if (isIP(ip) === 4) {
    const o = ip.split('.').map(Number);
    return o[0] === 0 || o[0] === 10 || o[0] === 127 || o[0] >= 224 || (o[0] === 100 && o[1] >= 64 && o[1] <= 127) ||
      (o[0] === 169 && o[1] === 254) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) ||
      (o[0] === 192 && o[1] === 0 && o[2] === 2) || (o[0] === 198 && o[1] === 51 && o[2] === 100) || (o[0] === 203 && o[1] === 0 && o[2] === 113);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isForbiddenIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('ff') || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

/** Returns { errors: [], warnings: [], hosts: [] } for a manifest object. */
export function validateManifest(m) {
  const errors = [];
  const warnings = [];
  const hosts = [];
  if (!m || typeof m !== 'object') return { errors: ['The manifest is not a JSON object.'], warnings, hosts };
  if (m.schemaVersion !== 1) errors.push('`schemaVersion` must be 1.');
  if (!validPluginId(m.id)) errors.push('`id` must look like `your-handle.plugin-slug`: lowercase letters, digits and hyphens, one dot.');
  if (typeof m.name !== 'string' || m.name.length < 2 || m.name.length > 80) errors.push('`name` must be 2 to 80 characters.');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(m.version ?? '')) errors.push('`version` must be semantic, for example 0.1.0.');
  if (!CATEGORIES.includes(m.category)) errors.push('`category` must be one of: ' + CATEGORIES.join(', ') + '.');
  if (!validRelPath(m.entry, 'js')) errors.push('`entry` must be a relative path to a .js file, for example dist/plugin.js.');
  if (!Array.isArray(m.permissions)) errors.push('`permissions` must be an array. Use [] if the plugin needs nothing.');
  for (const p of Array.isArray(m.permissions) ? m.permissions : []) {
    if (typeof p !== 'string') errors.push('Every permission must be a string.');
    else if (p.startsWith('net:')) {
      const host = p.slice(4);
      if (isPublicHostname(host)) hosts.push(host.toLowerCase());
      else errors.push(`\`${p}\`: the host must be a public domain name. No IP addresses, wildcards, localhost or internal domains.`);
    } else if (!ALLOWED_PERMISSIONS.includes(p)) errors.push(`\`${p}\` is not a permission the runtime offers.`);
  }
  if (m.providers !== undefined) {
    if (!Array.isArray(m.providers) || m.providers.length > MAX_PROVIDERS) errors.push('`providers` must be an array of provider ids, ' + MAX_PROVIDERS + ' at most.');
    else {
      const unknown = m.providers.filter((p) => typeof p !== 'string' || !(p in PROVIDERS));
      if (unknown.length) errors.push('`providers`: unknown id ' + unknown.map((p) => JSON.stringify(p)).join(', ') + '. Known ids: ' + Object.keys(PROVIDERS).join(', ') + '.');
      if (new Set(m.providers).size !== m.providers.length) errors.push('`providers` lists the same id twice.');
      // The model of `ai:generate` is Claude, run with no tools. Saying otherwise would mislead people.
      if ((m.permissions ?? []).includes('ai:generate') && m.providers.length && !m.providers.includes('claude-code-cli')) {
        warnings.push('This plugin uses `ai:generate`, which runs on Claude, but `providers` does not list `claude-code-cli`.');
      }
    }
  }
  // Menu entries and the permissions that come with them belong to the `pages` section only.
  const pages = m.contributes?.pages;
  const restricted = (Array.isArray(m.permissions) ? m.permissions : []).filter((p) => PAGES_ONLY_PERMISSIONS.includes(p));
  if (m.category !== 'pages') {
    if (Array.isArray(pages) && pages.length) errors.push('Only a `pages` plugin can declare `contributes.pages`.');
    if (restricted.length) errors.push('Reserved to the `pages` section: ' + restricted.join(', ') + '.');
  } else if (!Array.isArray(pages) || !pages.length || pages.length > MAX_MENU_PAGES) {
    errors.push('A `pages` plugin declares 1 to ' + MAX_MENU_PAGES + ' entries in `contributes.pages`.');
  } else {
    const ids = new Set();
    for (const p of pages) {
      const title = typeof p?.title === 'string' ? p.title.trim() : '';
      if (!slugOk(p?.id ?? '') || ids.has(p.id)) errors.push('`contributes.pages[].id` must be a unique lowercase slug, for example `writer`.');
      if (!title || [...title].length > 40 || /[\u0000-\u001f\u007f]/.test(title)) errors.push('`contributes.pages[].title` is required, 40 characters at most. It is the menu label.');
      if (p?.icon !== undefined && !validIcon(p.icon)) errors.push('`contributes.pages[].icon` must be a Tabler icon name, for example `ti-file-pencil`.');
      ids.add(p?.id);
    }
  }
  if (restricted.includes('git:read') && hosts.length) {
    warnings.push('`git:read` together with `net:` lets repository content leave the device. The reviewer will check what is sent to ' + hosts.join(', ') + '.');
  }
  for (const f of m.config?.fields ?? []) {
    if (!f?.key || !['text', 'secret', 'number', 'boolean', 'select', 'multiselect', 'url'].includes(f.type)) {
      errors.push(`Config field \`${f?.key ?? '?'}\` needs a key and a valid type.`);
    }
    if (f?.type === 'secret' && !(m.permissions ?? []).includes('secrets')) {
      warnings.push(`Config field \`${f.key}\` is a secret but the manifest does not request the \`secrets\` permission.`);
    }
  }
  if (!m.description) warnings.push('Add a `description`: it is what people read in the catalog.');
  return { errors, warnings, hosts };
}

const HEURISTICS = [
  ['fail', 'Hidden bidirectional control characters', /[‪-‮⁦-⁩]/u],
  ['warn', 'Dynamic code execution', /\beval\s*\(|new\s+Function\s*\(|\bimportScripts\s*\(|WebAssembly\s*\.|set(?:Timeout|Interval)\s*\(\s*['"`]/],
  ['warn', 'References to the host or browser storage', /__TAURI|messageHandlers|window\.ipc\b|chrome\.webview|\bwindow\.(?:top|opener)\b|\btop\.location|document\.cookie|\bindexedDB\b|\blocalStorage\b/],
  ['warn', 'Signs of obfuscation', /\b_0x[0-9a-f]{4,}\b|(?:\\x[0-9a-f]{2}){8,}|\batob\s*\(|String\.fromCharCode\s*\((?:\s*\d+\s*,){8,}/i],
];

/** Same heuristics the reviewer sees in the registry scan. */
export function scanSource(path, source, declaredHosts) {
  const findings = [];
  const lines = source.split('\n');
  for (const [severity, title, regex] of HEURISTICS) {
    lines.forEach((line, i) => {
      if (regex.test(line)) findings.push({ severity, title, file: path, line: i + 1, excerpt: line.trim().slice(0, 160) });
    });
  }
  const seen = new Set();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?:https?|wss?):\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) {
      const host = m[1].toLowerCase();
      if (!declaredHosts.includes(host) && !seen.has(host)) {
        seen.add(host);
        findings.push({ severity: 'warn', title: `Host not declared in permissions: ${host}`, file: path, line: i + 1, excerpt: line.trim().slice(0, 160) });
      }
    }
  });
  return findings;
}

/** `{{secret:key}}` substitution. Throws if a secret is missing: better an error than a placeholder sent to a third party. */
export function substituteSecrets(value, secrets) {
  return String(value).replace(/\{\{secret:([^}]*)\}\}/g, (_, key) => {
    key = key.trim();
    if (!(key in secrets) || !secrets[key]) throw new Error(`secret \`${key}\` is not configured`);
    return secrets[key];
  });
}

export const scrubSecrets = (text, secrets) =>
  Object.values(secrets).filter((s) => s && s.length >= 6).reduce((acc, s) => acc.split(s).join('[secret]'), String(text));

function checkUrl(manifest, url) {
  if (url.protocol !== 'https:') throw new Error('HTTPS only');
  if (url.username || url.password) throw new Error('credentials in the URL are not allowed');
  if (url.port && url.port !== '443') throw new Error('port 443 only');
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, ''))) throw new Error('the host must be a domain name');
  if (!(manifest.permissions ?? []).includes('net:' + host)) throw new Error(`host \`${host}\` is not declared in the plugin permissions`);
  return host;
}

/** Secrets are allowed in path and query, never in the host. Returns the URL plus a secret-free form for the log. */
export function resolveUrl(manifest, template, secrets) {
  template = String(template);
  if (!template.includes('{{secret:')) {
    const url = new URL(template);
    const host = checkUrl(manifest, url);
    return { url, host, audit: host + url.pathname };
  }
  if (!(manifest.permissions ?? []).includes('secrets')) throw new Error('permission `secrets` is not granted to this plugin');
  const authority = template.slice(template.indexOf('://') + 3).split(/[/?#]/)[0];
  if (authority.includes('{')) throw new Error('secrets are not allowed in the host part of the URL');
  const masked = new URL(substituteSecrets(template, Object.fromEntries(Object.keys(secrets).map((k) => [k, 'SECRET']))));
  const host = checkUrl(manifest, masked);
  const url = new URL(substituteSecrets(template, secrets));
  if (checkUrl(manifest, url) !== host) throw new Error('secret substitution changed the host');
  return { url, host, audit: host + masked.pathname };
}

export const FORBIDDEN_REQUEST_HEADERS = ['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'cookie', 'te', 'expect'];
export const RESPONSE_HEADERS = ['content-type', 'location', 'retry-after', 'link', 'etag', 'x-ratelimit-remaining', 'x-ratelimit-reset'];
