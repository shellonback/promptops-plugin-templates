// PromptOps Plugin Playground: the page plays the role of the app.
// The plugin runs in the SAME sandbox as in PromptOps: an iframe with an opaque
// origin, no network, no storage. Everything it returns is rendered as TEXT.

const $ = (sel) => document.querySelector(sel);
const h = (tag, props = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    // The page CSP blocks inline style attributes. Setting styles through the DOM is allowed.
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
// Every cell is an element: bare text nodes would merge into one grid item.
const kv = (...cells) => h('div', { class: 'kv' }, cells.map((c) => h('div', {}, c)));
const card = (title, ...body) => h('div', { class: 'card' }, h('div', { class: 'card-h' }, title), h('div', { class: 'card-b' }, ...body));
const api = (path, body) => fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined).then((r) => r.json());

const SECTION = {
  tasks: 'Teams › Board', code: 'Sessions › Git Explorer', data: 'Sessions › side panel', providers: 'Usage',
  agent: 'Spawn composer', context: 'Prompts › Project Brief', notify: 'Notifications',
};
const SAMPLE_EVENTS = {
  'session.started': { sessionId: 's_1', sessionName: 'checkout-refactor', provider: 'claude-code-cli' },
  'session.ended': { sessionId: 's_1', sessionName: 'checkout-refactor', provider: 'claude-code-cli', durationSec: 1840 },
  'turn.completed': { sessionId: 's_1', sessionName: 'checkout-refactor', provider: 'claude-code-cli', durationSec: 212, status: 'success' },
  'approval.requested': { sessionId: 's_1', sessionName: 'checkout-refactor', tool: 'Bash' },
  'task.status_changed': { taskId: '42', title: 'Fix login redirect', from: 'open', to: 'closed' },
};

const state = { plugin: null, mode: 'fixtures', config: {}, secrets: {}, frame: null, ready: null, pending: new Map(), seq: 0 };

// ── sandbox (mirrors the real host page) ─────────────────────────────────────
const LT = String.fromCharCode(60);
const inlineSafe = (js) => js.replace(new RegExp(LT + '/(script)', 'gi'), LT + '\\/$1').replace(new RegExp(LT + '!--', 'g'), LT + '\\!--');

async function mount() {
  if (state.frame) state.frame.remove();
  state.ready = null;
  setSandbox('starting');
  const sdk = await fetch('sdk.js').then((r) => r.text());
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.style.display = 'none';
  f.srcdoc = LT + '!doctype html>' + LT + 'meta charset="utf-8">'
    + LT + 'meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'">'
    + LT + 'script>' + inlineSafe(sdk) + LT + '/script>'
    + LT + 'script>' + inlineSafe(state.plugin.bundle) + LT + '/script>';
  state.frame = f;
  const ready = new Promise((resolve) => { state.onReady = resolve; });
  document.body.append(f);
  const info = await Promise.race([ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
  if (!info) { setSandbox('no answer', 'bad'); log({ method: 'sandbox', target: 'the plugin did not finish starting in 8 s', ok: false }); return null; }
  state.ready = info;
  setSandbox('running in sandbox', 'ok');
  return info;
}

addEventListener('message', async (ev) => {
  if (!state.frame || ev.source !== state.frame.contentWindow || !ev.data || typeof ev.data !== 'object') return;
  const msg = ev.data;
  if (msg.__po === 'ready') return state.onReady?.(msg);
  if (msg.__po === 'invokeResult') {
    const p = state.pending.get(msg.invokeId);
    if (!p) return;
    state.pending.delete(msg.invokeId);
    return msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
  }
  if (msg.__po !== 'call') return;
  const res = await api('/api/broker', { plugin: state.plugin.name, method: String(msg.method), params: msg.params || {}, mode: state.mode, config: state.config, secrets: state.secrets });
  log({ method: msg.method, target: res.audit ?? '', ok: res.ok, error: res.error });
  if (res.ui?.toast) toast(res.ui.toast);
  if (res.ui?.proposal) proposal(res.ui.proposal);
  ev.source.postMessage({ __po: 'result', callId: msg.callId, ok: res.ok, result: res.result, error: res.error }, '*');
});

function invoke(method, ...args) {
  const kind = state.plugin.manifest.category;
  const invokeId = 'i' + (++state.seq);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { state.pending.delete(invokeId); reject(new Error('the plugin did not answer within 30 s')); }, 30000);
    state.pending.set(invokeId, {
      resolve: (v) => { clearTimeout(timer); log({ method: 'invoke', target: `${kind}.${method} · ${Math.round(performance.now() - started)} ms`, ok: true }); resolve(v); },
      reject: (e) => { clearTimeout(timer); log({ method: 'invoke', target: `${kind}.${method}`, ok: false, error: e.message }); reject(e); },
    });
    state.frame.contentWindow.postMessage({ __po: 'invoke', invokeId, kind, method, args }, '*');
  });
}
const has = (method) => !!state.ready?.contributions?.find((c) => c.kind === state.plugin.manifest.category)?.methods.includes(method);
const runAction = (actionId, context) => state.frame.contentWindow.postMessage({ __po: 'action', actionId, context }, '*');
const fireEvent = (name, payload) => state.frame.contentWindow.postMessage({ __po: 'event', name, payload }, '*');

// ── chrome ───────────────────────────────────────────────────────────────────
function setSandbox(text, kind) { const el = $('#sandbox-state'); el.textContent = text; el.className = 'chip ' + (kind || ''); }
function log(entry) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const row = h('div', { class: entry.ok ? '' : 'denied' }, h('span', { class: 't' }, time + '  '), entry.method + '  ', String(entry.target ?? ''), entry.ok ? '' : '  · denied: ' + entry.error);
  $('#log').prepend(row);
}
function toast(message) {
  const el = h('div', { class: 'toast' }, h('div', { class: 'from' }, state.plugin.manifest.name + ' · plugin'), message);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 6000);
}
function proposal({ title, text }) {
  const close = () => $('#modal-root').replaceChildren();
  $('#modal-root').replaceChildren(
    h('div', { class: 'backdrop', onclick: close }),
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'head' }, title || 'Prompt proposed by a plugin', h('div', { class: 'muted small' }, 'from ' + state.plugin.manifest.name)),
      h('div', { class: 'body' },
        h('div', { class: 'note warn' }, 'In PromptOps the person sees this text before anything is sent. A plugin can never write to an agent on its own.'),
        h('pre', { class: 'text' }, text)),
      h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: close }, 'Dismiss'), h('button', { class: 'btn primary', onclick: () => navigator.clipboard?.writeText(text) }, 'Copy'))));
}
const fill = (el, ...nodes) => el.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
const guard = (target, fn) => async (...a) => {
  try { await fn(...a); } catch (e) { target.replaceChildren(h('div', { class: 'note bad' }, e.message)); }
};

// ── left column ──────────────────────────────────────────────────────────────
function renderLeft(templatesPermText) {
  const { manifest: m, validation: v, findings, bundleSha256, fixtureCount } = state.plugin;
  const left = $('#left');
  left.replaceChildren();

  const status = v.errors.length ? h('span', { class: 'chip bad' }, 'manifest invalid') : h('span', { class: 'chip ok' }, 'manifest valid');
  left.append(card(h('span', {}, m.name ?? state.plugin.name), kv(
    'id', h('span', { class: 'mono' }, m.id ?? '?'), 'section', h('span', {}, h('span', { class: 'chip accent' }, m.category ?? '?'), ' ', h('span', { class: 'muted small' }, SECTION[m.category] ?? '')),
    'version', m.version ?? '?', 'status', status, 'bundle', h('span', { class: 'mono' }, bundleSha256 ? bundleSha256.slice(0, 16) + '…' : 'missing'),
    'fixtures', String(fixtureCount)),
    bundleSha256 ? h('div', { class: 'row', style: '' }, h('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(bundleSha256) }, 'Copy bundle SHA-256')) : null));

  if (v.errors.length || v.warnings.length) {
    left.append(card('Fix these first', h('ul', { class: 'clean' },
      v.errors.map((e) => h('li', { class: 'note bad' }, e)), v.warnings.map((w) => h('li', { class: 'note warn' }, w)))));
  }

  left.append(card(h('span', {}, 'Permissions ', h('span', { class: 'muted small' }, 'what the person approves')),
    (m.permissions ?? []).length
      ? h('ul', { class: 'clean' }, m.permissions.map((p) => h('li', { class: 'perm' }, templatesPermText(p), h('code', {}, p))))
      : h('div', { class: 'muted' }, 'Nothing outside the sandbox.')));

  const fields = m.config?.fields ?? [];
  if (fields.length) {
    const form = h('div', { class: 'form' });
    for (const f of fields) {
      if (f.type === 'secret') {
        form.append(h('label', {}, (f.label ?? f.key) + ' · secret', h('input', { type: 'password', autocomplete: 'off', placeholder: 'Only needed in Live mode', oninput: (e) => { state.secrets[f.key] = e.target.value; } })));
      } else if (f.type === 'boolean') {
        form.append(h('label', {}, h('span', {}, h('input', { type: 'checkbox', checked: !!state.config[f.key], onchange: (e) => { state.config[f.key] = e.target.checked; } }), ' ', f.label ?? f.key)));
      } else if (f.type === 'select') {
        form.append(h('label', {}, f.label ?? f.key, h('select', { onchange: (e) => { state.config[f.key] = e.target.value; } },
          (f.options ?? []).map((o) => h('option', { value: o.value, selected: state.config[f.key] === o.value }, o.label)))));
      } else {
        form.append(h('label', {}, f.label ?? f.key, h('input', { type: f.type === 'number' ? 'number' : 'text', value: state.config[f.key] ?? '', oninput: (e) => { state.config[f.key] = f.type === 'number' ? Number(e.target.value) : e.target.value; } })));
      }
    }
    form.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: start }, 'Apply and restart plugin')));
    left.append(card(h('span', {}, 'Settings ', h('span', { class: 'muted small' }, 'generated from config.fields')), form));
  }

  left.append(card(h('span', {}, 'Reviewer scan ', h('span', { class: 'muted small' }, 'what PromptOps flags before approval')),
    findings.length
      ? h('ul', { class: 'clean' }, findings.map((f) => h('li', { class: 'note ' + (f.severity === 'fail' ? 'bad' : 'warn') }, f.title, h('div', { class: 'mono muted' }, `${f.file}:${f.line}  ${f.excerpt}`))))
      : h('div', { class: 'note ok' }, 'Nothing flagged in the bundle.')));
}

// ── center column: one preview per section ───────────────────────────────────
const previews = {
  async tasks(root) {
    const head = h('div', { class: 'row' });
    const picker = h('div', { class: 'row' });
    const board = h('div', {});
    const detail = h('div', {});
    root.append(head, picker, board, detail);
    if (has('validate')) {
      const who = await invoke('validate');
      head.append(h('span', { class: 'chip ' + (who?.ok ? 'ok' : 'bad') }, who?.ok ? 'connected' + (who.account ? ' as ' + who.account : '') : 'not connected: ' + (who?.error ?? '')));
    }

    // Values from a plugin are untrusted: a color is applied only if it is a plain hex.
    const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : null);
    const PRIORITY_CHIP = { critical: 'bad', high: 'warn' };
    let current = null;

    // Sources can be a tree (workspace › project › folder › list). One select per level;
    // the board appears when the person reaches a container that holds tasks.
    async function level(parentId, depth) {
      while (picker.children.length > depth) picker.lastChild.remove();
      const items = await invoke('listContainers', parentId);
      if (!items.length) {
        if (depth === 0) fill(board, h('div', { class: 'empty' }, 'The source returned no containers.'));
        return;
      }
      const select = h('select', { 'aria-label': 'Source level ' + (depth + 1) }, items.map((c) => h('option', { value: c.id }, c.name + (c.kind && c.kind !== 'list' ? '  ›' : ''))));
      const choose = guard(board, async () => {
        const c = items.find((x) => x.id === select.value);
        while (picker.children.length > depth + 1) picker.lastChild.remove();
        if (c.hasChildren) { fill(board); fill(detail); await level(c.id, depth + 1); } else { current = c.id; await show(c.id); }
      });
      select.addEventListener('change', choose);
      picker.append(select);
      await choose();
    }

    async function show(containerId) {
      fill(detail);
      fill(board, h('div', { class: 'muted' }, 'Loading…'));
      const [statuses, page] = await Promise.all([invoke('listStatuses', containerId), invoke('listTasks', { containerId, statuses: null, updatedSince: null, cursor: null })]);
      fill(board, h('div', { class: 'board' }, statuses.map((s) => {
        const tasks = page.tasks.filter((t) => t.status === s.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const color = safeColor(s.color);
        return h('div', { class: 'lane' },
          h('div', { class: 'lane-h' }, h('span', { class: 'row' }, color ? h('span', { class: 'swatch', style: `background:${color}` }) : null, s.name), h('span', {}, String(tasks.length))),
          tasks.map((t) => h('button', { class: 'task', onclick: guard(detail, () => open(t.id, statuses)) }, h('div', { class: 't' }, t.title),
            h('div', { class: 'tags' },
              t.priority && PRIORITY_CHIP[t.priority] ? h('span', { class: 'chip ' + PRIORITY_CHIP[t.priority] }, t.priority) : null,
              (t.labels ?? []).slice(0, 4).map((l) => h('span', { class: 'tag' }, l))))));
      })), page.nextCursor ? h('div', { class: 'muted small' }, 'More tasks available: nextCursor = ' + page.nextCursor) : null);
    }

    async function open(id, statuses) {
      const t = await invoke('getTask', id);
      const comments = has('listComments') ? await invoke('listComments', id) : [];
      fill(detail, card(h('span', {}, t.title),
        kv('status', has('setStatus')
          ? h('select', { onchange: guard(detail, async (e) => { await invoke('setStatus', id, e.target.value); await show(current); }) }, statuses.map((s) => h('option', { value: s.id, selected: s.id === t.status }, s.name)))
          : t.status,
          ...(t.priority ? ['priority', t.priority] : []),
          'assignees', (t.assignees ?? []).join(', ') || 'nobody', 'updated', t.updatedAt ?? '', 'link', h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, t.url)),
        h('pre', { class: 'text' }, t.description || 'No description.'),
        comments.length ? h('div', { class: 'list' }, comments.map((c) => h('div', { class: 'note' }, h('div', { class: 'muted small' }, `${c.author} · ${c.createdAt}`), c.body))) : null,
        state.ready.actions.includes('task-to-agent') ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => runAction('task-to-agent', { task: t }) }, 'Propose to agent')) : null));
    }

    await level(null, 0);
  },

  async context(root) {
    const input = h('input', { value: 'prompt engineering', style: 'flex:1' });
    const results = h('div', { class: 'list' });
    const preview = h('div', {});
    const run = guard(results, async () => {
      preview.replaceChildren();
      results.replaceChildren(h('div', { class: 'muted' }, 'Searching…'));
      const items = await invoke('search', input.value);
      results.replaceChildren(...(items.length ? items.map((it) => h('button', { class: 'item', onclick: guard(preview, () => open(it.id)) },
        h('div', { class: 't' }, it.title), h('div', { class: 'muted small' }, it.excerpt))) : [h('div', { class: 'empty' }, 'No results.')]));
    });
    async function open(id) {
      const doc = await invoke('get', id);
      preview.replaceChildren(card(h('span', {}, doc.title), h('a', { href: doc.url, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, doc.url),
        h('pre', { class: 'text' }, (doc.content ?? '').slice(0, 2500) + ((doc.content ?? '').length > 2500 ? '\n…' : '')),
        state.ready.actions.includes('use-as-context') ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => runAction('use-as-context', { document: doc }) }, 'Propose as context')) : null));
    }
    root.append(h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: run }, 'Search')), h('div', { class: 'split' }, results, preview));
    input.addEventListener('keydown', (e) => e.key === 'Enter' && run());
    await run();
  },

  async code(root) {
    const input = h('input', { value: state.config.repo || 'microsoft/vscode', style: 'flex:1', class: 'mono' });
    const list = h('div', { class: 'list' });
    const checks = h('div', {});
    const run = guard(list, async () => {
      checks.replaceChildren();
      list.replaceChildren(h('div', { class: 'muted' }, 'Loading…'));
      const prs = await invoke('listPullRequests', { repo: input.value.trim(), state: 'open' });
      list.replaceChildren(...(prs.length ? prs.map((pr) => h('button', { class: 'item', onclick: guard(checks, () => open(pr)) },
        h('div', { class: 't' }, `#${pr.number} ${pr.title}`), h('div', { class: 'muted small' }, `${pr.author} · ${pr.headRef}${pr.draft ? ' · draft' : ''}`))) : [h('div', { class: 'empty' }, 'No open pull requests.')]));
    });
    async function open(pr) {
      const items = await invoke('listChecks', { repo: input.value.trim(), ref: pr.headSha ?? pr.headRef });
      const kind = { success: 'ok', failure: 'bad', pending: 'warn' };
      checks.replaceChildren(card(`Checks for #${pr.number}`, items.length
        ? h('ul', { class: 'clean' }, items.map((c) => h('li', { class: 'row' }, h('span', { class: 'chip ' + (kind[c.status] ?? '') }, c.status), c.name)))
        : h('div', { class: 'muted' }, 'No checks reported.')));
    }
    root.append(h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Repository'), input, h('button', { class: 'btn primary', onclick: run }, 'Load')), h('div', { class: 'split' }, list, checks));
    await run();
  },

  async data(root) {
    const tabs = h('div', { class: 'row' });
    const table = h('div', { style: 'overflow:auto' });
    const resources = await invoke('listResources');
    const show = guard(table, async (id) => {
      for (const b of tabs.children) b.classList.toggle('primary', b.dataset.id === id);
      table.replaceChildren(h('div', { class: 'muted' }, 'Loading…'));
      const res = await invoke('query', { resourceId: id, limit: 25, filter: null });
      table.replaceChildren(h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, res.columns.map((c) => h('th', {}, c.label)))),
        h('tbody', {}, res.rows.map((r) => h('tr', {}, res.columns.map((c) => h('td', {}, String(r[c.key] ?? ''))))))),
        h('div', { class: 'muted small' }, `${res.rows.length} rows shown` + (res.total ? ` of ${res.total}` : '')));
    });
    tabs.append(...resources.map((r) => h('button', { class: 'btn', 'data-id': r.id, title: r.description ?? '', onclick: () => show(r.id) }, r.name)));
    root.append(tabs, table);
    if (resources.length) await show(resources[0].id); else table.replaceChildren(h('div', { class: 'empty' }, 'The explorer returned no resources.'));
  },

  async providers(root) {
    const u = await invoke('getUsage');
    root.append(h('div', { class: 'row' }, h('span', { class: 'chip accent' }, u.provider), u.plan ? h('span', { class: 'muted' }, u.plan) : null),
      h('div', { class: 'form' }, (u.meters ?? []).map((m) => {
        const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : null;
        return h('div', { class: 'meter' }, h('div', { class: 'row' }, h('strong', {}, m.label), h('span', { class: 'grow' }),
          h('span', { class: 'muted small' }, `${m.used}${m.limit ? ' / ' + m.limit : ''} ${m.unit ?? ''}` + (m.resetsAt ? ` · resets ${m.resetsAt}` : ''))),
          pct === null ? h('div', { class: 'muted small' }, 'No limit reported') : h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${pct}%` })));
      })));
  },

  async notify(root) {
    const names = state.ready.events.length ? state.ready.events : [];
    if (!names.length) return root.append(h('div', { class: 'empty' }, 'This plugin does not listen to any event. Use promptops.events.on(name, handler).'));
    root.append(h('div', { class: 'note' }, 'Events carry metadata only: never prompt text, answers, file paths or code. Edit the payload and fire it.'));
    for (const name of names) {
      const area = h('textarea', { rows: '8' });
      area.value = JSON.stringify(SAMPLE_EVENTS[name] ?? {}, null, 2);
      root.append(card(h('span', { class: 'mono' }, name), area, h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn primary', onclick: () => { try { fireEvent(name, JSON.parse(area.value)); } catch { toast('The payload is not valid JSON.'); } } }, 'Fire event'))));
    }
  },

  async agent(root) {
    const c = state.plugin.manifest.contributes ?? {};
    const preview = h('div', {});
    root.append(h('div', { class: 'note' }, 'Agent extensions are declarative: PromptOps reads them from the manifest and shows their full text to the person before installing.'),
      h('div', { class: 'split' },
        h('div', { class: 'list' },
          h('div', { class: 'muted small' }, 'Skills'),
          (c.skills ?? []).map((s) => h('button', { class: 'item', onclick: () => preview.replaceChildren(card(s.title, h('div', { class: 'muted small mono' }, s.file), h('pre', { class: 'text' }, state.plugin.extras[s.file] ?? 'File not found.'))) },
            h('div', { class: 't' }, s.title), h('div', { class: 'muted small' }, s.description ?? ''))),
          h('div', { class: 'muted small' }, 'Quick actions'),
          (c.quickActions ?? []).map((q) => h('button', { class: 'item', onclick: () => proposal({ title: q.title, text: q.prompt }) }, h('div', { class: 't' }, q.title), h('div', { class: 'muted small' }, 'Click to see the prompt the person would review')))),
        preview));
    if ((c.skills ?? []).length) root.querySelector('.item')?.click();
  },
};

async function renderCenter() {
  const center = $('#center');
  const m = state.plugin.manifest;
  const body = h('div', { class: 'form' });
  center.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, 'Preview', h('span', { class: 'muted small' }, 'how PromptOps shows this plugin in ' + (SECTION[m.category] ?? 'the app'))),
    h('div', { class: 'card-b' }, body)));

  if (state.plugin.validation.errors.length) return body.append(h('div', { class: 'empty' }, 'Fix the manifest errors on the left, then press Reload plugin.'));
  if (!state.ready) return body.append(h('div', { class: 'note bad' }, 'The plugin did not start. Check the Activity log and your browser console.'));

  const wants = { tasks: 'listContainers', context: 'search', code: 'listPullRequests', data: 'listResources', providers: 'getUsage' }[m.category];
  if (wants && !has(wants)) {
    body.append(h('div', { class: 'note bad' }, `A "${m.category}" plugin must register its contract. Nothing was registered for ${m.category}.${wants}. See docs/CONTRACTS.md.`));
  } else {
    await guard(body, () => previews[m.category]?.(body))();
  }

  // Only workspace-level actions belong here. The others run from their own context (a task, a document).
  const actions = (m.contributes?.actions ?? []).filter((a) => state.ready.actions.includes(a.id) && (!a.contexts || a.contexts.includes('workspace')));
  if (actions.length) {
    center.append(card(h('span', {}, 'Actions ', h('span', { class: 'muted small' }, 'menu entries the person can run')),
      h('div', { class: 'row' }, actions.map((a) => h('button', { class: 'btn', onclick: () => runAction(a.id, {}) }, a.title)))));
  }
}

// ── boot ─────────────────────────────────────────────────────────────────────
let describe = (p) => p;
async function start() {
  $('#log').replaceChildren();
  renderLeft(describe);
  if (!state.plugin.validation.errors.length) await mount(); else setSandbox('not started', 'bad');
  await renderCenter();
  document.body.dataset.ready = '1';
}
async function load(name) {
  delete document.body.dataset.ready;
  state.plugin = await api('/api/plugin?name=' + encodeURIComponent(name));
  state.config = Object.fromEntries((state.plugin.manifest.config?.fields ?? []).filter((f) => f.type !== 'secret' && f.default !== undefined).map((f) => [f.key, f.default]));
  state.secrets = {};
  history.replaceState(null, '', '?plugin=' + encodeURIComponent(name) + (state.mode === 'live' ? '&mode=live' : ''));
  await start();
}
function setMode(mode) {
  state.mode = mode;
  $('#mode-fixtures').classList.toggle('on', mode === 'fixtures');
  $('#mode-live').classList.toggle('on', mode === 'live');
}

const policy = await import('./lib-policy-text.js').catch(() => null);
if (policy) describe = policy.describePermission;
const query = new URLSearchParams(location.search);
setMode(query.get('mode') === 'live' ? 'live' : 'fixtures');
const templates = await api('/api/templates');
$('#picker').append(...templates.map((t) => h('option', { value: t.name }, `${t.category ?? '?'} · ${t.title ?? t.name}`)));
$('#picker').addEventListener('change', (e) => load(e.target.value));
$('#reload').addEventListener('click', () => load($('#picker').value));
$('#clear-log').addEventListener('click', () => $('#log').replaceChildren());
$('#mode-fixtures').addEventListener('click', () => { setMode('fixtures'); load($('#picker').value); });
$('#mode-live').addEventListener('click', () => { setMode('live'); load($('#picker').value); });
const first = templates.find((t) => t.name === query.get('plugin'))?.name ?? templates[0]?.name;
if (first) { $('#picker').value = first; await load(first); }
