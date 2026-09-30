# Setup and development

For the first run, see the [README](../README.md#get-started).
Run the commands below from the repository root unless noted otherwise.

## Connect from another device

Connect the server and your device to the same Tailscale network. Stop a standalone
Jelly process, then restart it from the repository root with:

```bash
JELLY_HOST=tailscale npm start
```

Open `http://<server-tailscale-ip>:47821` on your device. To get the connection key,
run this on the Jelly server from the repository root:

```bash
cat .data/token
```

Jelly serves the app and API on the same port. Tailscale Serve, Funnel and a separate
web server are not required. For systemd, use the service configuration below.

Jelly is for personal use on localhost or a private tailnet. Anyone with the
connection key can run commands as the server account, including over its configured
SSH connections. Keep the key private. This is not a multi-user sandbox.

## Installation dependencies

If `npm ci` needs to build `node-pty`, install Python 3, make and a C++ compiler.
For terminal controls and session behavior, see the [usage guide](GUIDE.md).

## Configuration

Jelly reads environment variables at startup.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JELLY_HOST` | `127.0.0.1` | Use `tailscale` to bind to this machine's Tailscale IPv4 address. |
| `JELLY_PORT` | `47821` | HTTP and WebSocket port. |
| `JELLY_DATA_DIR` | `.data` | Private directory for credentials, SQLite, and sockets. |
| `JELLY_SHELL` | `/bin/bash` | Shell for local sessions. |
| `JELLY_ORIGINS` | Binding address and local origins | Additional allowed origins, separated by commas. |
| `JELLY_SSH_CONFIG` | OpenSSH defaults | Optional SSH configuration file. |

An extra origin must be an exact HTTP(S) origin, including the port, with no
trailing slash. The server's Tailscale MagicDNS name is allowed automatically.
Jelly refuses wildcard, LAN, and public bind addresses. If Tailscale is unavailable,
starting in Tailscale mode fails.

Keep `.data/` private. Back up the database and `instance-id` together: the latter
identifies Jelly's remote tmux socket. Run only one Jelly process per data directory.

## Run as a service

Build Jelly, then install the user systemd service:

```bash
npm run build
node scripts/install-service.mjs
npm run deploy
```

The installer starts the service. To enable remote access, set these values in
`.data/service.env` and restart it:

```ini
JELLY_HOST=tailscale
JELLY_PORT=47821
```

```bash
systemctl --user restart jelly
systemctl --user status jelly
journalctl --user -u jelly -n 30
```

For updates, commit the changes and run `npm run deploy`. It builds the committed
source with `npm ci` in `.data/releases/<commit>`, switches `.data/current`
atomically, and restarts the API. A failed health check restores the previous
release. Uncommitted changes must be committed or stashed first.

The service runs the selected release, so development and test builds cannot
replace its files. After a successful deployment, cleanup keeps the current release
and the previous healthy release, recorded in `.data/current` and `.data/previous`.
Other recognized release builds are removed, including unused standalone builds.
A failed deployment does not run cleanup or replace the recovery pointer.

Hashed web chunks in `.data/web-assets` stay protected while either retained release
uses them. Once unused, they remain for another 30 days for older open tabs. Tabs
older than that may need a reload. Cleanup runs after successful deployments; it
has no background timer. You can inspect or run it separately:

```bash
npm run cleanup -- --dry-run
npm run cleanup
```

Cleanup only touches recognized release directories and generated JS/CSS assets.
It leaves credentials, databases, sockets and session processes alone, and refuses
invalid protected-release metadata or unsafe directory pointers. Build, deployment
and cleanup share a lock. `npm run release` builds without activating a release.

Release commands require Linux `flock` from util-linux. The OS releases the lock
after the deployment process and any build children holding it exit, including
after a forced termination. `.data/deploy.lock` remains as an empty file; do not
delete it, since replacing its inode could allow overlapping operations.
An old **directory** at that path belongs to the earlier locking scheme. It is
not removed automatically because its owner is unknown: first ensure no old
release/deploy/cleanup command is running, then remove the empty directory with
`rmdir .data/deploy.lock` before using the new commands.

For startup at boot and after logout, your account needs systemd lingering enabled.
An administrator can enable it with `loginctl enable-linger USER`.

The service uses `KillMode=process` so restarting the API leaves tmux sessions running.
If systemd can't find the user bus, set `XDG_RUNTIME_DIR` to `/run/user/$(id -u)` and
`DBUS_SESSION_BUS_ADDRESS` to `unix:path=$XDG_RUNTIME_DIR/bus`.

## Connection troubleshooting

Use the full address, including `http://` and `:47821`, and check that both devices
are connected to Tailscale. A successful request from the server itself doesn't
prove that another device can reach it.

If you use firewalld, check the zone assigned to `tailscale0`. If it is a dedicated
`tailscale` zone, allow Jelly's port there:

```bash
firewall-cmd --get-zone-of-interface=tailscale0
sudo firewall-cmd --zone=tailscale --add-port=47821/tcp
sudo firewall-cmd --permanent --zone=tailscale --add-port=47821/tcp
```

An SSH host must accept key-based, non-interactive connections from the account
running Jelly. Verify new host keys in a server terminal first. Encrypted keys need
an SSH agent that the Jelly process can access. Host-key verification stays enabled.

## CLI

The CLI reads the local endpoint and connection key from `.data/`.

```bash
npm run cli -- project-add my-project "$PWD"
npm run cli -- projects
npm run cli -- session-new PROJECT_ID work
npm run cli -- attach SESSION_ID
```

Press **Ctrl+]** to detach. **Ctrl+C** goes to the program running in the terminal.

```bash
npm run cli -- sessions
npm run cli -- history SESSION_ID 1000
npm run cli -- session-stop SESSION_ID
npm run cli -- session-delete SESSION_ID
```

Stopping or deleting a session ends its processes. Removing a project registration
doesn't delete the project folder. For a remote CLI, set `JELLY_URL` to the server's
Tailscale IP URL and `JELLY_TOKEN_FILE` to a securely transferred token file.

## Develop

The backend is in `src/`; the React and xterm.js client is in `web/`.
After installing dependencies, start a local backend:

```bash
npm run dev:server
```

In another terminal, run `npm run dev:web` and open `http://127.0.0.1:5173`.
Vite proxies API and WebSocket requests to loopback port 47822. Development uses
`.data/dev` for its own database, token and tmux socket. Restart `dev:server` after
server changes. `npm start` remains available for a standalone build in `dist/`.

## Tests

```bash
npm test
npm run check
npm run test:ssh
npx playwright install --with-deps chromium webkit
npm run test:web
npm run test:webkit
npm run test:soak
# Optional one-hour run, using only disposable local sessions:
JELLY_SOAK_SECONDS=3600 npm run test:soak
```

`npm test` builds in `.data/test-build` and runs the backend tests with real tmux
processes, plus deployment/rollback tests. All test commands build fresh artifacts
without modifying `dist/` or the selected service release.
The soak test defaults to 60 seconds. It rotates four sessions through three
concurrent attachments, delays output acknowledgements, and alternates graceful
and abrupt disconnects. It checks shell PIDs, connection and descriptor cleanup,
retained JS heap, and API/test-process and tmux RSS after warm-up. These are regression
thresholds for the tested duration, not a proof that all workloads have bounded memory.
SSH and browser tests also need Docker; they create disposable SSH servers and
temporary credentials. Tests use their own data directories and tmux sockets.

Chromium runs the full browser suite. WebKit covers keyboard geometry, virtual
keys, quick session creation, output flow, warm switching and workspace response
races. GitHub Actions runs both engines
with the backend and SSH suites. Mobile viewport and input simulations do not
replace testing on a physical iPhone.

## README media

To refresh the demo and screenshots, install FFmpeg with GIF and H.264 encoding
support, then run:

```bash
npm run build:test
npx playwright install chromium
node scripts/capture-demo.mjs
```

Set `FFMPEG=/path/to/ffmpeg` if it is not on your PATH. The script captures the real
app with disposable example projects on loopback, using its own data directory
and tmux socket. It writes desktop and mobile viewport screenshots, a GIF and an
MP4 to `docs/media/`, then removes its temporary sessions and files. Review the
generated media before committing it.
