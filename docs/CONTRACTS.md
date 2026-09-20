# Section contracts (version 0)

A plugin registers **one** contract: the one of its own section. PromptOps calls the methods and draws what they return. Return plain JSON data. Anything else is dropped.

Every method receives `sdk` as its **last** argument. Every method may be `async`. Throw an `Error` with a short message when something fails: PromptOps shows the message to the person.

- [The `sdk` object](#the-sdk-object)
- [tasks](#tasks) · [code](#code) · [data](#data) · [providers](#providers) · [context](#context) · [notify](#notify) · [agent](#agent)
- [Actions](#actions) · [Manifest](#manifest)

## The `sdk` object

| Call | Permission | What it does |
|---|---|---|
| `sdk.http.fetch(url, { method, headers, body })` | `net:<host>` | HTTPS request. Returns `{ status, ok, headers, body }`, with `body` as text |
| `{{secret:key}}` inside a header, or inside the URL path or query | `secrets` | PromptOps puts the value in when the request leaves. Never in the host, never in the body |
| `sdk.config.get()` | none | The non-secret settings, plus `__secretsSet`: the list of secret keys that have a value |
| `sdk.storage.get(key)` · `set(key, value)` · `remove(key)` | `storage` | Small JSON storage, private to your plugin |
| `sdk.notify.toast(message)` | `notify` | A short text notification |
| `sdk.prompt.propose(text, title)` | `prompt:propose` | Shows the person a prompt to review. Nothing is sent without them |
| `sdk.git.status(repo)` · `log(repo, limit)` · `diff(repo, { staged })` | `git:read` | Read-only git data of the repository the person picked. `pages` only |
| `sdk.workspace.writeFile(repo, path, content)` | `workspace:write` | Writes a text file under `docs/`. The person sees it and confirms. `pages` only |
| `sdk.ai.generate({ prompt, model })` | `ai:generate` | Runs the prompt on the person's Claude, with no tools. The person sees it and confirms. `pages` only |
| `sdk.pages.update(pageId, view)` | none | Pushes a new version of your page while you work |
| `sdk.log(...values)` | none | Writes a line in the plugin activity log |

`fetch`, `XMLHttpRequest`, `localStorage`, cookies and navigation do not work inside a plugin. Redirects are not followed: you receive the `3xx` status and the `location` header.

## tasks

```js
promptops.tasks.registerSource({ validate, listContainers, listStatuses, listTasks, getTask, setStatus, listComments });
```

| Method | PromptOps calls it when | Return |
|---|---|---|
| `validate()` | The person saves the settings | `{ ok, account?, error? }` |
| `listContainers(parentId)` | The person picks where tasks come from. `parentId` is `null` at the top, then the `id` of the container they opened | `[{ id, name, kind, hasChildren }]` with `kind`: `workspace`, `project`, `folder` or `list` |
| `listStatuses(containerId)` | It builds the board columns | `[{ id, name, type, color? }]` with `type`: `todo`, `in_progress` or `done`. `color` is a hex like `#5b5bd6` |
| `listTasks({ containerId, statuses, updatedSince, cursor })` | It syncs. `cursor` is the `nextCursor` you returned before | `{ tasks: [Task], nextCursor }` with `nextCursor: null` on the last page |
| `getTask(id)` | The person opens a task | `Task` |
| `setStatus(id, statusId)` *optional* | The person moves a card. Needs `tasks:write` | `Task` |
| `listComments(id)` *optional* | The person opens a task | `[{ id, author, body, createdAt }]` |

```
Task = { id, title, description, status, url, assignees: [string], labels: [string], updatedAt,
         priority?, order?, assigneeEmails?: [string] }
```

- `status` is the `id` of one of your statuses. Keep `id` stable: it links the task across syncs.
- A source can be flat or a tree. Return `hasChildren: true` for a container the person can open. Tasks are asked only for a container with `hasChildren: false`.
- `priority` is `low`, `medium`, `high` or `critical`. `order` sorts cards inside a column, lowest first.
- `assigneeEmails` lets PromptOps match assignees to team members. Lowercase them and sort them: a stable order keeps the sync quiet.
- Comments may add `authorEmail`.

## code

```js
promptops.code.registerHost({ listPullRequests, listChecks });
```

| Method | Return |
|---|---|
| `listPullRequests({ repo, state })` with `repo` as `owner/name`, `state` as `open` or `closed` | `[{ number, title, author, state, draft, url, headRef, headSha, updatedAt }]` |
| `listChecks({ repo, ref })` | `[{ name, status, url }]` with `status`: `success`, `failure`, `pending` or `neutral` |

This section reads metadata from the hosting service. A plugin cannot read local files or code.

## data

```js
promptops.data.registerExplorer({ listResources, query });
```

| Method | Return |
|---|---|
| `listResources()` | `[{ id, name, description? }]` |
| `query({ resourceId, limit, filter })` | `{ columns: [{ key, label }], rows: [object], total? }` |

Return at most `limit` rows. Cell values are shown as text.

## providers

```js
promptops.providers.registerUsage({ getUsage });
```

| Method | Return |
|---|---|
| `getUsage()` | `{ provider, plan?, meters: [{ id, label, used, limit, unit, resetsAt? }] }` |

`limit: null` means the provider reports no limit: PromptOps shows the number without a bar.

## context

```js
promptops.context.registerProvider({ search, get });
```

| Method | Return |
|---|---|
| `search(query)` | `[{ id, title, excerpt, url, updatedAt? }]` |
| `get(id)` | `{ id, title, url, content }` with `content` as plain text or Markdown, 50 000 characters at most |

The text comes from outside PromptOps. When you propose it as a prompt, say where it comes from and that it is reference material.

## notify

```js
promptops.events.on('turn.completed', async (event, sdk) => { /* ... */ });
```

Session events need `sessions:read`. Task events need `tasks:read`. Events carry metadata only: never prompt text, answers, file paths or code.

| Event | Payload |
|---|---|
| `session.started` | `{ sessionId, sessionName, provider }` |
| `session.ended` | `{ sessionId, sessionName, provider, durationSec }` |
| `turn.completed` | `{ sessionId, sessionName, provider, durationSec, status }` with `status`: `success` or `error` |
| `approval.requested` | `{ sessionId, sessionName, tool }` |
| `task.status_changed` | `{ taskId, title, from, to }` |

## pages

Your plugin adds an entry to the PromptOps menu and owns the page behind it. It never draws anything: it returns a **description of the page**, as plain data, and PromptOps draws it with its own components. No HTML, no CSS, no script ever comes from a plugin.

```json
"category": "pages",
"contributes": { "pages": [{ "id": "release-notes", "title": "Release Notes", "icon": "ti-notes" }] }
```

One to three entries. `title` is the menu label, 40 characters at most. `icon` is a [Tabler](https://tabler.io/icons) name. In the menu the entry carries a small puzzle, so people know it comes from a plugin.

```js
promptops.pages.register({
  async open(pageId, context, sdk) { return view; },
  async event(pageId, event, sdk) { return view; },
});
```

| Method | When | Returns |
|---|---|---|
| `open(pageId, context, sdk)` | The person opens the menu entry | The page |
| `event(pageId, event, sdk)` | The person clicks a button or changes a `live` field | The page, after your work |

`event` is `{ type: 'action' | 'change', id, values }`. `values` holds the whole form, keyed by field id, so you never need one call per keystroke. You have ten minutes to answer: waiting for a confirmation and for the model is fine. While you work the page is locked and the button shows a spinner. Your state lives inside the sandbox for as long as PromptOps is open.

The page is `{ title, subtitle, blocks }`. Blocks:

| `type` | Properties | Notes |
|---|---|---|
| `heading` | `text` | |
| `text` | `text`, `muted` | Plain text, line breaks kept |
| `notice` | `tone`: `info` `success` `warning` `danger`, `text` | |
| `divider` | | |
| `field` | `id`, `kind`, `label`, `value`, `help`, `placeholder`, `half`, `live` | See the kinds below |
| `actions` | `items`: `{ id, label, style, icon, disabled }` | `style`: `primary` `ghost` `danger`. Eight at most |
| `output` | `text`, `label`, `mono`, `copy`, and `id` + `editable` | Editable outputs come back in `values[id]` |
| `list` | `items`: `{ title, subtitle, meta, icon }`, `empty` | |
| `table` | `columns`: strings, `rows`: arrays of strings | Eight columns at most |
| `stats` | `items`: `{ label, value, hint }` | Six at most |
| `progress` | `value` from 0 to 1, `label` | Use it with `sdk.pages.update` |
| `columns` | `columns`: two arrays of blocks | Top level only. Columns never nest |

Field kinds: `text`, `textarea` (`rows`), `select` and `choice` (`options`: `{ value, label, icon, hint }`), `toggle`, and `repo`.
`half: true` puts two short fields on one row. `live: true` sends a `change` event as soon as the value changes.

**The `repo` field.** PromptOps draws it and lists the folders the person works on. When they pick one you receive `{ handle, name, branch }`. The handle is what you pass to `sdk.git.*` and `sdk.workspace.writeFile`. You never see a path, and a handle is valid only for your plugin, until PromptOps closes.

**What PromptOps drops.** Unknown block types, fields with an unknown kind or a bad id, icons that are not a Tabler name, columns inside columns, and anything over the size limits. Every text is shown as text. The playground lists what was dropped and why.

**Asking the person.** `sdk.workspace.writeFile` and `sdk.ai.generate` open a confirmation with the full file or the full prompt. If the person says no, the call rejects with an error that starts with `user_denied`. No answer in three minutes rejects with `confirm_timeout`. Treat both as a normal outcome, not as a failure.

| Call | Returns |
|---|---|
| `sdk.git.status(repo)` | `{ branch, files: [{ status, path }], total, truncated }` |
| `sdk.git.log(repo, limit)` | `[{ shortHash, message, relativeDate, author }]`, 100 at most. No email addresses |
| `sdk.git.diff(repo, { staged })` | `{ diff, truncated }`, 200 000 bytes at most |
| `sdk.workspace.writeFile(repo, path, content)` | `{ path, repo, overwritten }`. `path` must be `docs/<name>.md`, `.markdown` or `.txt` |
| `sdk.ai.generate({ prompt, model })` | `{ text, truncated }`. One run at a time, thirty per hour |

## agent

No code. Everything is in the manifest:

```json
"contributes": {
  "skills": [{ "id": "review-checklist", "title": "Review checklist", "description": "…", "file": "skills/review-checklist.md" }],
  "quickActions": [{ "id": "review-diff", "title": "Review my diff", "prompt": "…" }]
}
```

Skill and quick action text ends up in an agent prompt, so PromptOps shows it in full before the person installs the plugin.

## Actions

Any section can add menu entries.

```json
"contributes": { "actions": [{ "id": "send-test", "title": "Send a test message", "contexts": ["workspace"] }] }
```

```js
promptops.actions.register('send-test', async (context, sdk) => { /* ... */ });
```

`contexts` says where the entry appears: `workspace`, `task`, `document`. The `context` argument carries the item the person clicked, for example `{ task }`.

## Manifest

`promptops-plugin.json`, in the root of your plugin folder.

| Field | Rule |
|---|---|
| `schemaVersion` | `1` |
| `id` | `your-handle.plugin-slug`. Lowercase letters, digits, hyphens, one dot. Permanent |
| `name` | 2 to 80 characters |
| `version` | Semantic: `0.1.0`. Every submission needs a higher one |
| `category` | One of `tasks`, `code`, `data`, `providers`, `context`, `notify`, `agent`, `pages` |
| `entry` | Relative path to **one** `.js` file, already built. 2 MB at most. No build step runs on install |
| `permissions` | Array. `net:<host>` per host, plus any of `secrets`, `storage`, `notify`, `sessions:read`, `tasks:read`, `tasks:write`, `prompt:propose`, `agents:propose`. For `pages` also `git:read`, `workspace:write`, `ai:generate` |
| `config.fields` | `[{ key, type, label, required?, default?, options? }]` with `type`: `text`, `secret`, `number`, `boolean`, `select`, `multiselect`, `url`. PromptOps builds the form |
| `description` | Shown in the catalog |
| `repository` | Optional. Your public GitHub repository, as `https://github.com/owner/name`. PromptOps shows the owner and its avatar next to the plugin |
| `providers` | Optional. The AI providers you have tried your plugin with, best first: `claude-code-cli`, `codex`, `gemini-cli`, `antigravity`, `copilot`, `cursor`, `grok`, `hermes`, `zai`, `kimi`, `opencode`. The catalog shows the first three as small icons, then `+N` |
| `contributes.pages` | `pages` only. One to three menu entries: `{ id, title, icon }` |

`providers` is your statement: "it works with these". List only what you tested. Leave it out if your plugin does not depend on the provider, like a task source or a notifier. A plugin that uses `ai:generate` runs on Claude, so list `claude-code-cli`.

Hosts must be public domain names. No IP addresses, wildcards, `localhost` or internal domains.
