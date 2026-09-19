// Same rules as the PromptOps desktop runtime (Rust) and the registry scanner (PHP).
// Keep the three in sync: a plugin that passes here must behave the same in the app.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const CATEGORIES = ['tasks', 'code', 'data', 'providers', 'agent', 'context', 'notify'];

export const ALLOWED_PERMISSIONS = [
  'secrets', 'storage', 'notify', 'sessions:read', 'tasks:read', 'tasks:write', 'prompt:propose', 'agents:propose',
];

export const PERMISSION_TEXT = {
  secrets: 'Use the credentials you configure, without ever reading them',
  storage: 'Keep its own small local data',
  notify: 'Show notifications',
  'sessions:read': 'See the names and status of your sessions, not their content',
  'tasks:read': 'Read tasks of the project where it is active',
  'tasks:write': 'Create and update tasks of the project where it is active',
  'prompt:propose': 'Propose a prompt that you review before it is sent',
  'agents:propose': 'Propose starting an agent, which you confirm',
};

export const describePermission = (p) => (p.startsWith('net:') ? `Connect to ${p.slice(4)} over HTTPS` : PERMISSION_TEXT[p] ?? p);

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const slugOk = (s) => /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/.test(s);
export const validPluginId = (id) => typeof id === 'string' && id.split('.').length === 2 && id.split('.').every(slugOk);

export const validRelPath = (p, ext) =>
  typeof p === 'string' && p.length <= 200 && !p.includes('..') && !p.startsWith('/') && !p.startsWith('.') &&
  /^[A-Za-z0-9_./-]+$/.test(p) && p.toLowerCase().endsWith('.' + ext);

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
