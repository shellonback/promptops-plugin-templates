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
| `category` | One of `tasks`, `code`, `data`, `providers`, `context`, `notify`, `agent` |
| `entry` | Relative path to **one** `.js` file, already built. 2 MB at most. No build step runs on install |
| `permissions` | Array. `net:<host>` per host, plus any of `secrets`, `storage`, `notify`, `sessions:read`, `tasks:read`, `tasks:write`, `prompt:propose`, `agents:propose` |
| `config.fields` | `[{ key, type, label, required?, default?, options? }]` with `type`: `text`, `secret`, `number`, `boolean`, `select`, `multiselect`, `url`. PromptOps builds the form |
| `description` | Shown in the catalog |
| `repository` | Optional. Your public GitHub repository, as `https://github.com/owner/name`. PromptOps shows the owner and its avatar next to the plugin |

Hosts must be public domain names. No IP addresses, wildcards, `localhost` or internal domains.
