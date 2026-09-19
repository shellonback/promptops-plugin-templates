// SDK iniettato da PromptOps in ogni iframe di plugin, PRIMA del bundle.
// L'unico canale verso l'esterno è postMessage alla pagina ospite.
(() => {
  'use strict';
  const pending = new Map();
  const activators = [];
  const actions = new Map();
  const contributions = new Map(); // sezione -> implementazione del contratto
  const listeners = new Map();     // evento -> [handler]
  let seq = 0;

  const contribute = (kind) => (impl) => { if (impl && typeof impl === 'object') contributions.set(kind, impl); };

  const call = (method, params) => new Promise((resolve, reject) => {
    const callId = ++seq;
    pending.set(callId, { resolve, reject });
    parent.postMessage({ __po: 'call', callId, method, params: params || {} }, '*');
  });

  addEventListener('message', async (ev) => {
    if (ev.source !== parent || !ev.data || typeof ev.data !== 'object') return;
    const msg = ev.data;
    if (msg.__po === 'result') {
      const p = pending.get(msg.callId);
      if (!p) return;
      pending.delete(msg.callId);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'denied'));
    } else if (msg.__po === 'action') {
      const fn = actions.get(msg.actionId);
      if (!fn) return;
      try { await fn(msg.context || {}, sdk); } catch (e) { call('log', { message: 'action ' + msg.actionId + ' failed: ' + (e && e.message || e) }); }
    } else if (msg.__po === 'invoke') {
      // L'app chiama un metodo del contratto di sezione; il risultato sono solo DATI:
      // è l'app a disegnarli, il plugin non porta mai interfaccia propria.
      let reply;
      try {
        const impl = contributions.get(msg.kind);
        if (!impl || typeof impl[msg.method] !== 'function') throw new Error('not implemented: ' + msg.kind + '.' + msg.method);
        const result = await impl[msg.method](...(Array.isArray(msg.args) ? msg.args : []), sdk);
        reply = { ok: true, result: result === undefined ? null : result };
      } catch (e) {
        reply = { ok: false, error: String(e && e.message || e) };
      }
      parent.postMessage(Object.assign({ __po: 'invokeResult', invokeId: msg.invokeId }, reply), '*');
    } else if (msg.__po === 'event') {
      for (const fn of listeners.get(msg.name) || []) {
        try { await fn(msg.payload || {}, sdk); } catch (e) { call('log', { message: 'event ' + msg.name + ' failed: ' + (e && e.message || e) }); }
      }
    }
  });

  const sdk = Object.freeze({
    http: Object.freeze({ fetch: (url, init) => call('http.fetch', Object.assign({ url: String(url) }, init || {})) }),
    storage: Object.freeze({
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
      remove: (key) => call('storage.set', { key, value: null }),
    }),
    config: Object.freeze({ get: () => call('config.get') }),
    notify: Object.freeze({ toast: (message) => call('notify.toast', { message: String(message) }) }),
    prompt: Object.freeze({ propose: (text, title) => call('prompt.propose', { text: String(text), title: title ? String(title) : '' }) }),
    log: (...args) => call('log', { message: args.map(String).join(' ') }),
  });

  Object.defineProperty(globalThis, 'promptops', {
    value: Object.freeze({
      sdk,
      onActivate: (fn) => { if (typeof fn === 'function') activators.push(fn); },
      actions: Object.freeze({ register: (id, fn) => { if (typeof fn === 'function') actions.set(String(id), fn); } }),
      // Contratti per sezione. Un plugin può registrare solo quello della PROPRIA categoria.
      tasks: Object.freeze({ registerSource: contribute('tasks') }),
      context: Object.freeze({ registerProvider: contribute('context') }),
      code: Object.freeze({ registerHost: contribute('code') }),
      data: Object.freeze({ registerExplorer: contribute('data') }),
      providers: Object.freeze({ registerUsage: contribute('providers') }),
      // Eventi dell'app: solo metadati, mai testo di prompt, risposte o codice.
      events: Object.freeze({ on: (name, fn) => {
        if (typeof fn !== 'function') return;
        const key = String(name);
        listeners.set(key, (listeners.get(key) || []).concat(fn));
      } }),
    }),
    writable: false, configurable: false,
  });

  // Dopo che il bundle ha registrato i suoi handler
  addEventListener('load', () => setTimeout(async () => {
    for (const fn of activators) {
      try { await fn(sdk); } catch (e) { call('log', { message: 'activate failed: ' + (e && e.message || e) }); }
    }
    parent.postMessage({
      __po: 'ready',
      contributions: Array.from(contributions, ([kind, impl]) => ({ kind, methods: Object.keys(impl).filter((k) => typeof impl[k] === 'function') })),
      events: Array.from(listeners.keys()),
      actions: Array.from(actions.keys()),
    }, '*');
  }, 0));
})();
