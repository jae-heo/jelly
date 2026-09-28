# Setup and development

For the first run, see the [README](../README.md#get-started).
Run the commands below from the repository root unless noted otherwise.

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
After installing dependencies and building, start a local backend:

```bash
JELLY_HOST=127.0.0.1 JELLY_ORIGINS=http://127.0.0.1:5173 npm start
```

In another terminal, run `npm run dev:web` and open `http://127.0.0.1:5173`.
Vite proxies API and WebSocket requests to port 47821. Rebuild the backend with
`npm run build:server` and restart it after server changes.

## Tests

```bash
npm test
npm run check
npm run test:ssh
npx playwright install chromium
npm run test:web
```

`npm test` builds the app and runs the backend tests with real tmux processes.
SSH and browser tests also need Docker; they create disposable SSH servers and
temporary credentials. Tests use their own data directories and tmux sockets.

Browser tests run in Chromium. Mobile viewport and input simulations don't replace
testing on a physical phone.
