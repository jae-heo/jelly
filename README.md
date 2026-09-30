# Jelly

A web terminal for your own servers. Open a project on your phone or computer,
run your tools, and come back to the same session later.

![Jelly switching projects, creating a session and reconnecting after a refresh](docs/media/jelly-demo.gif)

[Watch the video](docs/media/jelly-demo.mp4)

- **Persistent sessions.** Closing the tab or restarting Jelly keeps your shells running.
- **Local and SSH projects.** Remote servers only need SSH, a POSIX shell and tmux.
- **Phone-friendly input.** Touch scrolling, Unicode input and a floating keyboard for key combinations.

<details>
<summary>On your phone</summary>
<br>
<img src="docs/media/mobile-terminal.png" width="240" alt="Jelly running a development server in a mobile viewport">
<img src="docs/media/mobile-keyboard.png" width="240" alt="The floating keyboard with Ctrl+C selected before sending">
</details>

## Get started

Requires Linux, Node.js 24 and tmux 3.2+.

```bash
git clone https://github.com/jae-heo/jelly.git
cd jelly
npm ci
npm run build
npm start
```

Open [localhost:47821](http://127.0.0.1:47821), enter the connection key from
`.data/token`, and add a project folder.

For phone access, follow the [Tailscale setup](docs/SETUP.md#connect-from-another-device).

## Guides

- [Using Jelly](docs/GUIDE.md) — projects, sessions, input and shortcuts.
- [Setup and development](docs/SETUP.md) — remote access, SSH, configuration and tests.
- [API reference](docs/API.md) — HTTP and WebSocket.

[MIT](LICENSE) · Built with React, xterm.js, Node.js and tmux.
