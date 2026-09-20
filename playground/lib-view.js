// What PromptOps does with the page a `pages` plugin returns, before drawing it.
// Same rules as the app (plugin-page-view.ts): keep them in sync.
// A page is DATA. Unknown blocks are dropped, every text becomes a capped string, nothing is ever HTML.
const MAX_BLOCKS = 200;
const TONES = ['info', 'success', 'warning', 'danger'];
const KINDS = ['text', 'textarea', 'select', 'choice', 'toggle', 'repo'];
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,59}$/;
const ICON = /^ti-[a-z0-9-]{2,45}$/;

const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
export const safeIcon = (v) => (typeof v === 'string' && ICON.test(v) ? v : null);
const repoValue = (v) => (typeof obj(v).handle === 'string' && obj(v).handle ? { handle: str(v.handle, 80), name: str(v.name, 120), branch: str(v.branch, 200) } : null);

function block(raw, depth, budget, dropped) {
  const b = obj(raw);
  if (budget.left-- <= 0) return null;
  const drop = (why) => { dropped.push(why); return null; };
  switch (b.type) {
    case 'heading': return { type: 'heading', text: str(b.text, 200) };
    case 'text': return { type: 'text', text: str(b.text, 4000), muted: b.muted === true };
    case 'notice': return { type: 'notice', tone: TONES.includes(b.tone) ? b.tone : 'info', text: str(b.text, 1000) };
    case 'divider': return { type: 'divider' };
    case 'field': {
      const id = str(b.id, 60);
      if (!KINDS.includes(b.kind)) return drop(`field "${id}": unknown kind "${str(b.kind, 40)}"`);
      if (!ID.test(id)) return drop(`field with an invalid id "${id}"`);
      const options = list(b.options, 60).map(obj).map((o) => ({ value: str(o.value, 200), label: str(o.label, 120) || str(o.value, 120), icon: safeIcon(o.icon), hint: str(o.hint, 160) }));
      const value = b.kind === 'toggle' ? b.value === true : b.kind === 'repo' ? repoValue(b.value) : str(b.value, 200000);
      return { type: 'field', kind: b.kind, id, label: str(b.label, 160), help: str(b.help, 400), placeholder: str(b.placeholder, 200),
        rows: Math.min(Math.max(Number(b.rows) || 5, 2), 24), live: b.live === true, half: b.half === true, options, value };
    }
    case 'actions': {
      const items = list(b.items, 8).map(obj).filter((i) => ID.test(str(i.id, 60))).map((i) => ({
        id: str(i.id, 60), label: str(i.label, 60) || str(i.id, 60), icon: safeIcon(i.icon), disabled: i.disabled === true,
        style: ['primary', 'ghost', 'danger'].includes(i.style) ? i.style : 'default' }));
      return items.length ? { type: 'actions', items } : drop('actions without a valid item');
    }
    case 'output': {
      const id = str(b.id, 60);
      return { type: 'output', id: ID.test(id) ? id : null, label: str(b.label, 160), text: str(b.text, 200000), mono: b.mono === true, copy: b.copy !== false, editable: b.editable === true && ID.test(id) };
    }
    case 'list': return { type: 'list', empty: str(b.empty, 200), items: list(b.items, 200).map(obj).map((i) => ({ title: str(i.title, 200), subtitle: str(i.subtitle, 400), meta: str(i.meta, 80), icon: safeIcon(i.icon) })) };
    case 'table': { const columns = list(b.columns, 8).map((c) => str(c, 80)); return { type: 'table', columns, rows: list(b.rows, 200).map((r) => columns.map((_, i) => str(list(r, 8)[i], 400))) }; }
    case 'stats': return { type: 'stats', items: list(b.items, 6).map(obj).map((i) => ({ label: str(i.label, 60), value: str(i.value, 60), hint: str(i.hint, 120) })) };
    case 'progress': return { type: 'progress', label: str(b.label, 160), value: Math.min(Math.max(Number(b.value) || 0, 0), 1) };
    case 'columns': return depth > 0 ? drop('columns inside columns') : { type: 'columns', columns: list(b.columns, 2).map((col) => blocks(col, depth + 1, budget, dropped)) };
    default: return drop(`unknown block type "${str(b.type, 40)}"`);
  }
}
const blocks = (raw, depth, budget, dropped) => list(raw, MAX_BLOCKS).map((b) => block(b, depth, budget, dropped)).filter(Boolean);

/** Returns the view PromptOps would draw, plus what it dropped and why: useful while you write the page. */
export function normalizeView(raw) {
  const v = obj(raw);
  const dropped = [];
  return { title: str(v.title, 80), subtitle: str(v.subtitle, 300), blocks: blocks(v.blocks, 0, { left: MAX_BLOCKS }, dropped), dropped };
}

export function viewValues(view) {
  const out = {};
  const walk = (items) => { for (const b of items) { if (b.type === 'field') out[b.id] = b.value; else if (b.type === 'output' && b.editable && b.id) out[b.id] = b.text; else if (b.type === 'columns') b.columns.forEach(walk); } };
  walk(view.blocks);
  return out;
}
