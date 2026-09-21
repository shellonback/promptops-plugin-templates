#!/usr/bin/env node
// Creates YOUR plugin repository from a template.
//   node tools/new-plugin.mjs tasks ../my-plugin acme.linear-tasks "Linear"
//
// The new folder is self-contained: it holds only your plugin and its own README.
// It does not depend on this repository, except as the tool you test it with.
import { cp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, describePermission, validPluginId } from '../playground/lib/policy.mjs';

// The public home of the templates.
const TEMPLATES_URL = 'https://github.com/shellonback/promptops-plugin-templates';
const SECTION = {
  tasks: 'Teams › Board', code: 'Sessions › Git Explorer', data: 'Sessions › side panel', providers: 'Usage',
  agent: 'Spawn composer', context: 'Prompts › Project Brief', notify: 'Notifications',
};

const [section, target, id, name] = process.argv.slice(2);
const usage = () => { console.error('\n  Usage: node tools/new-plugin.mjs <section> <new-folder> <handle.slug> "<Name>"\n  Sections: ' + CATEGORIES.join(', ') + '\n'); process.exit(1); };
if (!CATEGORIES.includes(section) || !target || !name) usage();
if (!validPluginId(id)) { console.error('\n  ✗ The id must look like your-handle.plugin-slug (lowercase, digits, hyphens, one dot).\n'); process.exit(1); }

const from = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', section);
const to = resolve(process.cwd(), target);
if (await stat(to).catch(() => null)) { console.error(`\n  ✗ ${to} already exists.\n`); process.exit(1); }

await cp(from, to, { recursive: true });
const file = join(to, 'promptops-plugin.json');
const manifest = { ...JSON.parse(await readFile(file, 'utf8')), id, name };
delete manifest.repository; // yours is different: add it once your repository exists
await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');

// The template README explains the template. Your repository needs a README about YOUR plugin.
await rm(join(to, 'README.md'), { force: true });
const perms = manifest.permissions.length
  ? manifest.permissions.map((p) => `| \`${p}\` | ${describePermission(p)} |`).join('\n')
  : '| none | Nothing outside the sandbox |';
await writeFile(join(to, 'README.md'), `<a href="https://promptops.it"><img src="${TEMPLATES_URL.replace('github.com', 'raw.githubusercontent.com')}/main/docs/brand/promptops-icon.png" alt="Built for PromptOps" width="40"></a>

# ${name}

A [PromptOps](https://promptops.it) plugin for the **${section}** section. It appears in ${SECTION[section]}.

> Describe in two sentences what your plugin does and which service it connects to.

| | |
|---|---|
| Plugin id | \`${id}\` |
| Section | \`${section}\` |

## What it can do

People approve these permissions before installing. A plugin can never read prompts, agent answers, files or the terminal.

| Permission | Meaning |
|---|---|
${perms}

## Install

Open **Plugins** in PromptOps, find **${name}** and press **Install**.

## Develop

This repository contains only the plugin. You test it with the PromptOps templates repository, which holds the playground.

\`\`\`bash
git clone ${TEMPLATES_URL}.git
node promptops-plugin-templates/playground/server.mjs --plugin .
\`\`\`

Open http://127.0.0.1:4173. Your plugin is the entry that starts with \`local:\`.

| File | What it is |
|---|---|
| \`promptops-plugin.json\` | The manifest: id, section, hosts, permissions, settings |
| \`src/plugin.js\` | The source of the plugin. Plain JavaScript, no build step: what you read is what runs |
| \`fixtures.json\` | Sample answers for offline testing. Not used by PromptOps |

Method names and return shapes: [section contracts](${TEMPLATES_URL}/blob/main/docs/CONTRACTS.md#${section}).

To try it inside PromptOps, open **Plugins › Installed**, turn on **Developer mode** and link this folder.

## Release

\`\`\`bash
node promptops-plugin-templates/tools/validate.mjs .
\`\`\`

1. Raise \`version\` in \`promptops-plugin.json\`, commit and push. The repository must be public.
2. In PromptOps open **Plugins › My plugins** and press **Submit for review**.
3. Paste the version, commit SHA, bundle SHA-256 and manifest printed by the command above.

The current version stays live until the new one is approved.
`);
await writeFile(join(to, '.gitignore'), 'node_modules/\n.DS_Store\n*.log\n');

console.log(`\n  ✓ Created ${to}\n\n  Next:\n    cd ${target}\n    git init && git add . && git commit -m "Start from the PromptOps ${section} template"\n    node ${join(dirname(fileURLToPath(import.meta.url)), '..', 'playground', 'server.mjs')} --plugin .\n`);
