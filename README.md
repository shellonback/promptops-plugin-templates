<p align="center">
  <a href="https://promptops.it">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/brand/promptops-wordmark-dark.png">
      <img alt="PromptOps" src="docs/brand/promptops-wordmark-light.png" height="52">
    </picture>
  </a>
</p>

<h1 align="center">Plugin Templates</h1>

<p align="center">
  One starter plugin for every section of PromptOps, plus a graphical playground to test it in your browser.<br>
  Nothing to install.
</p>

<p align="center">
  <a href="#try-it-in-one-minute">Try it</a> ·
  <a href="#pick-your-section">Sections</a> ·
  <a href="#make-your-own-plugin">Make your own</a> ·
  <a href="docs/CONTRACTS.md">Contracts</a> ·
  <a href="docs/SECURITY.md">Security</a> ·
  <a href="README.it.md">Italiano</a>
</p>

![The playground running the tasks template](docs/screenshots/tasks.png)

## Try it in one minute

You need [Node.js](https://nodejs.org) 18 or newer. There is no `npm install`.

```bash
git clone https://github.com/shellonback/promptops-plugin-templates.git
cd promptops-plugin-templates
node playground/server.mjs
```

Open **http://127.0.0.1:4173** and pick a section from the dropdown at the top.

What you are looking at:

| Area | What it shows |
|---|---|
| **Left** | The manifest, the permissions a person will approve, the settings form generated from your manifest, and what the PromptOps reviewer scan flags |
| **Center** | A preview of how PromptOps draws your plugin's data in that section |
| **Right** | Every request your plugin made, including the ones that were denied and why |

The plugin runs in the same sandbox PromptOps uses: no network, no storage, no access to the page. Its only way out is the `sdk` object.

## Pick your section

A plugin belongs to exactly one section. Start from the template of that section.

| Section | Template | Your plugin provides | Shown in PromptOps |
|---|---|---|---|
| `tasks` | [templates/tasks](templates/tasks) | Tasks from a tracker | Teams › Board |
| `code` | [templates/code](templates/code) | Pull requests and CI checks | Sessions › Git Explorer |
| `data` | [templates/data](templates/data) | Tables from an API or a database service | Sessions › side panel |
| `providers` | [templates/providers](templates/providers) | Credit and quota of an AI provider | Usage |
| `context` | [templates/context](templates/context) | Documents to use as context | Prompts › Project Brief |
| `notify` | [templates/notify](templates/notify) | Messages sent when something happens | Notifications |
| `agent` | [templates/agent](templates/agent) | Skills and quick actions, no code | Spawn composer |
| `pages` | [templates/pages](templates/pages) | A tool with its own page, described as data | Its own entry in the sidebar menu |

Exact method names, arguments and return shapes are in [docs/CONTRACTS.md](docs/CONTRACTS.md).

## Make your own plugin

**1. Copy a template.** Choose the section, a folder, your id and a name.

```bash
node tools/new-plugin.mjs tasks ../my-plugin acme.linear-tasks "Linear"
```

The id is `your-handle.plugin-slug`. The handle is the one of your publisher profile in PromptOps. It never changes.

**2. Open it in the playground.**

```bash
node playground/server.mjs --plugin ../my-plugin
```

**3. Edit three files.** After each change press **Reload plugin**.

| File | What to change |
|---|---|
| `promptops-plugin.json` | Name, description, the hosts you call, the settings people fill in |
| `dist/plugin.js` | The calls to your service and the mapping to the PromptOps shapes |
| `fixtures.json` | Sample answers from your service, so the plugin works offline |

**4. Check it.**

```bash
node tools/validate.mjs ../my-plugin
```

It runs the same checks as PromptOps and prints the values you will need in step 6.

**5. Try it inside PromptOps.** Open **Plugins › Installed**, turn on **Developer mode**, paste the folder path and press **Link folder**. Your plugin runs in the real sandbox.

**6. Publish it.**
1. Push your plugin to a **public GitHub repository**. The code must be public: PromptOps reviews it and people can read it.
2. In PromptOps open **Plugins › Create plugin**. Publish as yourself or as a team you administer.
3. Press **Submit for review** and paste the version, commit SHA, bundle SHA-256 and manifest printed by `validate.mjs`.
4. A PromptOps admin scans the code at that exact commit and approves or rejects it. Updates follow the same path, and the current version stays live until the update is approved.

## The rules

What a plugin **can** do, only if its manifest asks and the person approves:

- Call HTTPS hosts listed in `permissions`, one entry per host: `net:api.example.com`.
- Use credentials through `{{secret:key}}` placeholders. The plugin never sees the value.
- Keep a small local storage, show a notification, propose a prompt for the person to review.

What a plugin **can never** do:

- Read your prompts, agent answers, files, terminal or PromptOps account.
- Run a program, load code from the internet, or talk to a host it did not declare.
- Send anything to an agent on its own. It proposes, the person decides.
- Ship its own interface. It returns data and PromptOps draws it.

More detail in [docs/SECURITY.md](docs/SECURITY.md).

## Fixtures and Live

| Mode | What happens | Use it for |
|---|---|---|
| **Fixtures** | Requests are answered from `fixtures.json`. No internet. Declared secrets count as set | Building the mapping, screenshots, demos |
| **Live** | Real HTTPS requests, through the same rules as the app: declared hosts only, no internal addresses, no redirects | Checking against the real service. Type secrets in the Settings card |

Secrets typed in the playground stay in your browser tab and in the local server memory. They are never written to disk.

## Where things live

| Repository | Owner | Contains |
|---|---|---|
| This one | PromptOps | The seven templates, the playground, the tools and the contracts |
| Your plugin | **You** | Only your plugin: `promptops-plugin.json`, `dist/plugin.js`, `fixtures.json`, your README |

The seven templates are in **one repository on purpose**. They share the playground, the SDK copy, the rules and the tools, so they cannot drift apart, and a change to a contract updates all of them in one commit.

`tools/new-plugin.mjs` creates your repository from a template. The new folder is self-contained, with its own README, and you publish it under your own account. To test it you point the playground at it with `--plugin`.

If you keep several plugins in one repository of yours, give each its own folder and fill in **Subfolder** when you submit.

## What is in this repository

```
playground/   the test page and the local broker (server.mjs)
templates/    one starter plugin per section
tools/        new-plugin.mjs, validate.mjs, index-entry.mjs, screenshots.mjs
registry/     official.json: the official plugins, each pinned to a commit and a bundle hash
docs/         CONTRACTS.md, SECURITY.md, screenshots
```

## What works in PromptOps today

| Piece | State |
|---|---|
| Sandbox, permissions, secrets, storage, notifications, prompt proposals | Working in the desktop app |
| Calling your section contract from the app | Working. Test it in **Plugins › Installed › Test contract** |
| Section screens drawing your data: board, usage, explorers | Being connected. Until then the playground is the visual reference |
| `agent` skills and quick actions | Playground only for now |
| `pages`: menu entry, repository, saving in `docs/`, Claude with no tools | Work in the desktop app on macOS. Linux to be verified, `ai:generate` not yet on Windows |

Contracts are version 0. They can still change before the section screens ship.

## License

The code is MIT. See [LICENSE](LICENSE).

The PromptOps name and logos in `docs/brand/` are trademarks of their owner. They are here so that plugins can say they are built for PromptOps. The MIT license does not cover them.
