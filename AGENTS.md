# Jelly / 줼리

- This is an independent project at `/path/to/jelly`.
- Use 줼리 as the Korean product name and Jelly as the English name.
- Keep Jelly minimal: projects, persistent terminal sessions, HTTP/WebSocket, and the requested React web terminal. No IDE or unrelated features.
- Keep UI copy short and factual: labels, state, and actionable errors. Avoid slogans, conversational prompts, redundant hints, and routine success notifications.
- The web client lives in `web/`, uses React/TypeScript/Vite and xterm.js, and is served by the existing API process at the same Tailscale address.
- Bind the backend to loopback for local development or this machine's verified Tailscale IPv4 address for remote access. Never bind to 0.0.0.0, a LAN/public address, or require Tailscale Serve/Funnel.
- Use Jelly's private tmux socket. Never operate on the default tmux server or unrelated sessions.
- SSH targets need only SSH, a POSIX shell and tmux 3.2+. Never install Jelly or an agent remotely. Use the dedicated `jelly-<instanceId>` tmux socket name for remote work.
- Reuse the Jelly account's OpenSSH configuration and keys. Preserve host-key verification; never silently trust an unknown/changed host key or expose private-key contents to the browser.
- Run `npm run test:ssh` for remote execution changes. SSH integration and browser tests use disposable Docker containers with OpenSSH/tmux and temporary credentials.
- Disconnecting a client or stopping the API must not terminate its shell. Only explicit session termination may do that.
- Keep credentials, SQLite files, socket files, terminal output and machine-specific deployment settings out of Git.
- Test with temporary data directories and dedicated tmux sockets. Clean up only resources created by that test.
- Run `npm test` and `npm run check` after meaningful backend changes.
- Goal scope and acceptance criteria live in `docs/GOAL.md`.
