<a href="../../README.md"><img src="../../docs/brand/promptops-icon.png" alt="PromptOps" width="40"></a>

# tasks template: GitHub Issues

Turns the issues of a GitHub repository into tasks on the **Teams › Board**. Use it as the base for any tracker: Jira, Linear, Asana, Trello.

![Preview of this template in the playground](../../docs/screenshots/tasks.png)

## Try it

From the root of this repository:

```bash
node playground/server.mjs
```

Open http://127.0.0.1:4173 and choose **tasks · GitHub Issues** in the dropdown. It starts in **Fixtures** mode, so it works offline.

## What you implement

| Method | You return |
|---|---|
| `validate()` | Whether the credentials work, and for which account |
| `listContainers(parentId)` | The places tasks live in: here, the repositories from the settings |
| `listStatuses(containerId)` | The board columns: here, Open and Closed |
| `listTasks({ containerId, updatedSince, cursor })` | One page of tasks and a `nextCursor` |
| `getTask(id)` | One task |
| `setStatus(id, statusId)` *optional* | The updated task. Delete it for a read-only source |
| `listComments(id)` *optional* | The comments of a task |

The action `task-to-agent` proposes a prompt built from the task. The person reviews it before anything is sent.

Exact shapes: [docs/CONTRACTS.md](../../docs/CONTRACTS.md#tasks).

## The three files

| File | What it is |
|---|---|
| `promptops-plugin.json` | The manifest: id, section, hosts, permissions, settings |
| `src/plugin.js` | The source of the plugin. One file of plain JavaScript, no dependencies and no build step: what you read is what runs |
| `fixtures.json` | Sample answers for Fixtures mode. First match wins, `*` matches anything |

## Make it yours

Copy the template first, so your work lives in its own folder:

```bash
node tools/new-plugin.mjs tasks ../my-plugin your-handle.my-plugin "My Plugin"
node playground/server.mjs --plugin ../my-plugin
```

Then:

1. In `promptops-plugin.json` replace `net:api.github.com` with the host of your tracker. One `net:` entry per host.
2. Remove `tasks:write` if your plugin does not change tasks, and delete `setStatus` from the code.
3. Replace the settings in `config.fields` with what your service needs: workspace, project key, token.
4. In `src/plugin.js` rewrite `github()` for your API, then `toTask()`: it is the only place that knows the remote shape.
5. Map your workflow in `STATUSES`. `type` must be `todo`, `in_progress` or `done`.
6. Record real answers from your API into `fixtures.json`, with private data removed.

Press **Reload plugin** after each change. Denied requests appear in red in the Activity log, with the reason.

## Test against the real service

Public repositories work without a token, up to 60 requests per hour. To move cards, type a GitHub token with the `issues: write` scope in the Settings card and switch to **Live**.

## Before you submit

```bash
node tools/validate.mjs ../my-plugin
```

- [ ] `id` starts with your publisher handle and `version` is higher than the published one
- [ ] `permissions` lists every host you call, and nothing you do not use
- [ ] The plugin works in **Live** mode against the real service
- [ ] The Reviewer scan on the left shows nothing you cannot explain
- [ ] The repository is public and the commit you submit is pushed

How to publish: [main README, step 6](../../README.md#make-your-own-plugin).
