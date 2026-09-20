#!/usr/bin/env node
// Regenerates docs/screenshots/*.png by driving a headless Chrome. Zero dependencies (Node 22+).
//   node playground/server.mjs &      then      node tools/screenshots.mjs
// It waits until the playground says the preview is ready, runs an optional click, then captures.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SHOTS_DIR ?? join(ROOT, 'docs', 'screenshots');
const BASE = process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:4173';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Dark is the PromptOps look. Use SCHEME=light for the light theme.
const SCHEME = process.env.SCHEME === 'light' ? 'light' : 'dark';

// name, plugin, optional JS to run after the preview is ready
// Override with SHOTS='[["name","plugin","js or null"]]' to capture your own plugin (run the server with --plugin).
const DEFAULT_SHOTS = [
  ['tasks', 'tasks', "document.querySelector('.task')?.click()"],
  ['code', 'code', "document.querySelector('#center .item')?.click()"],
  ['context', 'context', "document.querySelector('#center .item')?.click()"],
  ['data', 'data', null],
  ['providers', 'providers', null],
  ['notify', 'notify', "document.querySelector('#center .btn.primary')?.click()"],
  ['agent', 'agent', null],
  ['pages', 'pages', "(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const pick = document.querySelector('#center .pg-page select'); pick.value = 'repo_playground'; pick.dispatchEvent(new Event('change')); await wait(700); document.querySelector('#center .pg-page .btn.primary')?.click(); await wait(500); document.querySelector('#modal-root .btn.primary')?.click(); await wait(900); })()"],
];
const SHOTS = process.env.SHOTS ? JSON.parse(process.env.SHOTS) : DEFAULT_SHOTS;

const profile = await mkdtemp(join(tmpdir(), 'po-shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    target = await fetch('http://127.0.0.1:9333/json').then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
  }
  if (!target) throw new Error('Chrome did not start. Set CHROME=/path/to/chrome');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; waiting.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: SCHEME }] });
  await mkdir(OUT, { recursive: true });

  for (const [name, plugin, after] of SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${BASE}/?plugin=${plugin}` });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { await sleep(250); ready = await evaluate("document.body?.dataset.ready === '1'"); }
    if (!ready) throw new Error(`${plugin}: the preview never became ready`);
    if (after) { await evaluate(after); await sleep(900); }
    const height = Math.min(2200, Math.max(900, await evaluate('document.documentElement.scrollHeight')));
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
    const denied = await evaluate("document.querySelectorAll('#log .denied').length");
    const broken = await evaluate("document.querySelectorAll('#center .note.bad').length");
    console.log(`  ${name}.png  ${height}px  denied calls: ${denied}  errors shown: ${broken}`);
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
