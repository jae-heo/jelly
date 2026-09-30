# Jelly

A web terminal for your own servers. Open a project on your phone or computer,
run a command, and come back to the same session later.

Jelly keeps shells running in tmux, so closing the browser or restarting Jelly
won't stop your work. It supports local projects and remote servers over SSH.
Remote servers only need SSH, a POSIX shell, and tmux—nothing else to install.

## Get started

You'll need Linux, Node.js 24, and tmux 3.2 or newer.

```bash
git clone https://github.com/jae-heo/jelly.git
cd jelly
npm ci
npm run build
npm start
```

Open [localhost:47821](http://127.0.0.1:47821). In another terminal, read your
connection key from the `jelly` directory:

```bash
cat .data/token
```

Paste the key into the login screen, add an existing project folder, and open a session.

If `npm ci` needs to compile `node-pty`, install Python 3, make, and a C++ compiler.

## Connect from another device

Connect your server and device to the same Tailscale network. Stop the local
Jelly process, then start it with:

```bash
JELLY_HOST=tailscale npm start
```

Open `http://<server-tailscale-ip>:47821` on your phone or computer and use the
same connection key. Jelly serves the web app and API on that one port.
Tailscale Serve, Funnel, and a separate web server aren't needed.

## Using Jelly

- Add a folder on the Jelly server, or choose an SSH host and browse its folders.
- Sessions appear under their project. Fold a project with its arrow, or use its **+** to open a session.
- Open a terminal and run your usual tools, including Codex or Claude Code.
- Close the tab to disconnect. Use the session's stop action when you want to end it.
- Open the same session on another device to take control. The previous connection closes.
- Press **⌘⇧,** or **⌘⇧.** to move through sessions in project order, skipping empty projects and wrapping at the ends.
- Press **⌘⇧Enter** to create and open a session in the current project.

Jelly keeps your three most recently visited terminals connected across projects,
so switching back doesn't need a new connection. Older sessions keep running on
the server and reconnect when you open them again.

On phones, tap the keyboard button beside live input to open terminal keys.
Select a key and modifiers such as Ctrl or Alt, then tap **Send**. Selecting keys
doesn't transmit them. You can also add Jelly to your home screen. The app's
interface is in English. Terminal input supports Unicode, including Korean IME.
Opening the keyboard keeps the terminal's row count unchanged and brings the
cursor into view, so apps and scrollback aren't rearranged each time.

**Shift+Enter** is sent as a distinct key so terminal apps can use it for newlines.
Its behavior depends on the running app.
In the separate message input (pencil button), it inserts a newline into the draft.

For SSH projects, Jelly uses the service account's existing OpenSSH settings and
keys. Set up key-based access and verify the host key from that account before
connecting through the browser.

## A few things to know

Jelly is for personal use over Tailscale. It binds to localhost or the server's
own Tailscale address. Anyone with the connection key can run commands as the
server account, so keep the key private.

Sessions survive disconnections and Jelly restarts, but not a reboot of the
machine running the shell. Terminal history is limited tmux scrollback, not a
permanent log. Jelly uses its own tmux sockets and leaves your other sessions alone.

Runtime data lives in `.data/`, which is excluded from Git. Real-device iPhone
keyboard and input testing is still incomplete.

## More

- [Setup and development](docs/SETUP.md): configuration, systemd, CLI, and tests.
- [API reference](docs/API.md): HTTP endpoints and the WebSocket protocol.

Built with React, xterm.js, Node.js, and tmux.

## License

[MIT](LICENSE) · Copyright (c) 2026 jae-heo.
