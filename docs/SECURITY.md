# How a plugin is contained

Read this once. It explains why some things you may be used to are not available.

## Where your code runs

Your bundle runs inside an `<iframe sandbox="allow-scripts">` with an opaque origin and the policy `default-src 'none'`. That iframe lives in a hidden window of PromptOps that has no native permissions at all.

| You try | Result |
|---|---|
| `fetch`, `XMLHttpRequest`, `WebSocket`, images, fonts | Blocked |
| `localStorage`, `indexedDB`, cookies | Blocked |
| `parent`, `top`, `window.open`, navigating away | Blocked |
| Native app APIs | Not present, and denied by the app if reached |
| `eval`, `new Function`, remote scripts | Flagged at review. You do not need them |

## The only way out: the broker

Every `sdk` call is a message to a broker written in Rust. The broker reads the permissions from the **installed manifest**, never from what the plugin says, and denies anything that is not declared.

For `sdk.http.fetch` the broker requires: HTTPS, port 443, a host that appears in `permissions`, a host that is a domain name, and a DNS answer that is not loopback, private, link-local or otherwise internal. The connection is pinned to the address it checked. Redirects are not followed.

## Pages: repositories, files and the model

A `pages` plugin can ask for three permissions that no other section can have. Each one goes through the person.

- **`git:read`**. The plugin never names a folder. PromptOps draws the repository picker and gives the plugin a handle, valid only for that plugin and only until the app closes. Git runs with fixed arguments and no shell. External diff drivers and text filters of the repository are not executed. Commit authors come without email addresses.
- **`workspace:write`**. Only text files under `docs/` of the picked repository. Symbolic links that leave the repository are refused. Before every write the person sees the path, whether a file is replaced, and the full content.
- **`ai:generate`**. The prompt runs on the person's own Claude with no tools, no MCP servers and no skills, in an empty folder. It cannot read files, run commands or go online: it can only answer with text. Before every run the person sees the full prompt. One run at a time, thirty per hour. Today it works on macOS and Linux, with Claude only.

`git:read` together with a `net:` permission means repository content could leave the device. It is allowed, but the scanner flags it and the reviewer checks what is sent.

The page itself is data. PromptOps draws it with its own components and shows every value as text, so a plugin cannot put HTML, CSS or script in the app.

## Secrets

Credentials are stored on the person's device. Your code writes `{{secret:key}}` and the broker substitutes the value when the request leaves, only towards a declared host. Secrets are allowed in headers and in the URL path or query, never in the host, never in the body. They are removed from the response you receive, and the activity log records the URL with `SECRET` in their place.

## Prompts

A plugin never writes to an agent. `sdk.prompt.propose` shows the person a text they can read, edit and send, or dismiss. An agent with auto-approve can run commands, so a prompt written silently by a plugin would be remote code execution by proxy.

Text from third-party services is untrusted input. When you build a proposal from it, say where it comes from and that it is information, not instructions.

## Review and integrity

- Your code must be in a public GitHub repository.
- Each version is pinned to a commit and to the SHA-256 of the bundle.
- A PromptOps admin scans the code at that commit. Blocking findings: unreadable repository, manifest that differs from the submitted one, bundle hash mismatch, permissions outside the list, hidden bidirectional characters. Warnings: dynamic code, references to the host or browser storage, remote scripts, obfuscation, hosts that are not declared.
- On install the app downloads the bundle itself and refuses it if the hash differs. The hash is checked again every time the plugin loads.
- A revoked plugin is disabled on every device at the next sync.

## The activity log

Every call is written to a local log the person can open from **Plugins › Installed › Activity**: method, target, allowed or denied. Never bodies, never secrets.

## Reporting a problem

If you find a way around any of this, please do not open a public issue. Write to the PromptOps team privately.
