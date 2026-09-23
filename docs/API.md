# Jelly API v0.1

Local development: `http://127.0.0.1:47821`. Remote mode: `http://TAILSCALE_IP:47821` over the Tailscale VPN.
`JELLY_HOST=tailscale` discovers and binds only this machine's Tailscale IPv4 address. Serve is not required.
All `/api/*` HTTP routes require `Authorization: Bearer <token>`.
JSON request bodies require `Content-Type: application/json`. API responses are JSON, uncached.
If Origin is present, it must match the binding IP/MagicDNS origin or the exact `JELLY_ORIGINS` allowlist (loopback defaults also allowed).
No cross-origin CORS permissions are issued; the web client uses the same origin.

The public web entry point is `GET /` (also `HEAD`). `/jelly.svg` and built JavaScript/CSS
under `/assets/` are public; no source files, credentials or arbitrary directories are served.
HTML is uncached, hashed assets are immutable, and the page applies a same-origin Content Security Policy.
The login form verifies the bearer token before storing it in sessionStorage (default) or
localStorage (explicit remember-device selection). WebSockets use the short-lived ticket flow below.

## HTTP

| Method | Path | Request / result |
| --- | --- | --- |
| GET | `/healthz` | `{status:"ok",service:"jelly"}` (liveness) |
| GET | `/api/ssh/aliases` | `{aliases:["alias",...]}`; concrete Host names from the Jelly account's SSH config and Include files |
| GET | `/api/hosts` | `{hosts:[...]}`; registered SSH targets |
| POST | `/api/hosts` | `{name,target,port?,identityFile?}` → host (201); same target/options returns existing host (200) |
| POST | `/api/hosts/check` | same body as host registration → `{status:"ok",tmux:"tmux VERSION"}`; read-only connection test |
| POST | `/api/hosts/:id/check` | test a registered SSH target |
| DELETE | `/api/hosts/:id` | registration only; 409 while projects reference it |
| GET | `/api/directories?path=/absolute/path&hidden=false&hostId=UUID` | `{path,parent,home,directories:[{name,path}],truncated}`; omit hostId for local |
| GET | `/api/projects` | `{projects:[...]}` |
| POST | `/api/projects` | `{name,path,hostId?}` → project (201); existing absolute directory on that server only; missing/null hostId means local |
| GET | `/api/projects/:id` | project |
| DELETE | `/api/projects/:id` | metadata only; 409 if any session records remain |
| GET | `/api/projects/:id/sessions` | `{sessions:[...]}` |
| POST | `/api/projects/:id/sessions` | `{name?,cols?,rows?}` → session (201) |
| GET | `/api/sessions` | all session records and current tmux state |
| GET | `/api/sessions/:id` | session with current state |
| POST | `/api/sessions/:id/stop` | terminate session processes, keep stopped record; idempotent |
| DELETE | `/api/sessions/:id` | terminate session and delete record |
| GET | `/api/sessions/:id/history?lines=1000` | `{text,format:"plain",lines}`; requested history plus current screen |
| POST | `/api/sessions/:id/tickets` | `{ticket,expiresIn:30}` (201); browser WS authorization |

Host: `{id,name,target,port,identityFile,createdAt}`. `target` is an OpenSSH alias or `[user@]hostname`;
it must not contain whitespace, shell syntax or SSH flags. Port is 1–65535 or null (use SSH config).
`identityFile` is an absolute or `~/` path on the Jelly server, or null; no key content is accepted.
At most 20 hosts may be registered. Authentication uses existing OpenSSH keys/agent with BatchMode;
unknown/changed host keys are rejected. No Jelly installation is performed on remote hosts.

Project: `{id,name,path,hostId,createdAt}`. Paths are canonicalized on the selected server;
duplicate real paths on the same host return 409. Existing projects migrate with `hostId:null`.
The migration saves a private SQLite backup before modifying a populated legacy project table.
Directory browsing defaults to the selected server account's home directory. `path` must be absolute;
the returned current path is canonicalized. `parent` is null at `/`. Only subdirectories and
links to directories are listed; dot-prefixed names require `hidden=true`. Files and their contents
are never returned. One level is read, with at most 1,000 directories; `truncated=true` means only
part of a larger directory is shown. The list is sorted by name, with numeric ordering. Browsing is
read-only, uses the Jelly account's filesystem permissions, and requires the same authentication
and Origin checks as other API routes. Missing paths return 404, inaccessible paths 403, and
invalid paths or non-directories 400.
Session: `{id,projectId,name,createdAt,stoppedAt,status,connected,pid?,cols?,rows?,exitCode?}`.
IDs are UUIDs. `status` is `running`, `exited`, `stopped`, `lost`, or `unreachable`.
The last means an SSH host could not be queried; it never marks the metadata stopped or deletes work.
`pid` is the tmux pane's shell PID; it is not necessarily the foreground agent PID.
Names: 1–100 characters. Terminal: 2–500 columns, 2–200 rows; defaults 80×24.
Maximum 100 session records; delete old records to create more. Registration never creates/deletes source directories.
An exited session keeps its screen until explicitly deleted/stopped; attachment requires a running shell.
Stopping/deleting terminates work, and its in-memory tmux history becomes unavailable.

Errors: `{error:"message"}` with HTTP 400 (invalid input), 401 (auth), 403 (origin),
404 (missing), 409 (state conflict), 413 (size), 415 (content type), 429 (ticket limit), 502 (SSH), or 500.
SSH errors use `SSH_HOST_KEY`, `SSH_AUTH`, `SSH_UNREACHABLE`, `SSH_TMUX_MISSING`,
`SSH_TMUX_VERSION`, or `SSH_COMMAND_FAILED`; raw command arguments and SSH diagnostics are not returned.
Mutations are serialized inside one backend instance. Do not run multiple backends against one data directory.

## WebSocket

`/api/sessions/:id/terminal?cols=80&rows=24`

- CLI: pass the Bearer header during upgrade.
- Browser: obtain a ticket using an authenticated POST; attach with `&ticket=...`.
- Tickets expire after 30 seconds, are session-scoped and single use, and disappear on API restart.
- Never put the long-lived API token in a URL. Proxy logs must also omit ticket query strings.
- A newer connection takes over the session and closes the previous connection with 4001.

Client → server, JSON text frames:

```json
{"type":"input","data":"pwd\r"}
{"type":"input","data":"\u0003"}
{"type":"resize","cols":80,"rows":24}
```

Server → client:

```json
{"type":"ready","sessionId":"...","cols":80,"rows":24}
{"type":"output","data":"raw terminal text and ANSI sequences"}
{"type":"exit","exitCode":0}
```

`ready` is emitted with the tmux client's first output after terminal initialization. Early input is held
until that point (up to 64 KiB, 5-second startup deadline) so tmux startup cannot discard keystrokes.
SSH attachments allow 10 seconds and wait for tmux's alternate-screen initialization instead of
treating an SSH banner as ready. Resize and input travel through the SSH PTY to remote tmux.
An `exit` message refers to the
attachment process, not necessarily the shell; use GET session to inspect the shell's actual state.
Output must be fed to a terminal emulator (for example xterm.js), not inserted as HTML.
Do not rely on raw output containing whole lines: ANSI commands and Unicode may arrive in separate frames.

Close codes: 1000 normal detach/end, 1008 invalid input, 1012 backend restarting,
1013 slow consumer, 4001 replacement by a newer client. WebSocket ping/pong detects abandoned connections.
Client disconnect always leaves the tmux session intact.

## curl example without a token in command arguments

Run from the repository root on the server (replace the URL with the running endpoint from `.data/endpoint.json`):

```bash
curl --fail-with-body --config <(printf 'header = "Authorization: Bearer %s"\n' "$(cat .data/token)") \
  http://127.0.0.1:47821/api/projects
```

The supplied CLI reads the token file directly and is preferable for routine use.
