# Using Jelly

For installation and remote access, see [Setup](SETUP.md).

## Projects and sessions

Add an existing folder on the Jelly server, or select an SSH host and browse its
folders. Sessions appear beneath their project. Use **+** to create a session,
and the arrow beside a project to fold its session list.

A session is a persistent shell. Run your usual tools, including Codex or Claude
Code. Closing the browser or choosing **Disconnect** detaches your connection;
**Stop session** ends the shell and its running programs.

Opening a session on another device takes control and disconnects the previous
client. Jelly keeps the three most recently visited terminals connected across
projects. Older sessions keep running and reconnect when selected.

Sessions survive Jelly restarts, but not a reboot of the machine running the shell.
Jelly uses private tmux sockets and leaves unrelated tmux sessions alone.

## Codex and Claude Code

Install and sign in to the CLI you use on the machine running the project, under
its shell account. For an SSH project, that means the remote server.

Create a session named **Codex** in your project and run:

```bash
codex
```

Try a request such as:

> Add a /api/status route and a test for it.

Or create a session named **Claude Code** and run:

```bash
claude
```

For example:

> Review the API routes and point out missing error cases.

Keep a separate **Tests** session for commands such as `npm test`. Switch between
the assistant and terminal sessions, or reopen the same session from your phone.
On a phone, use **Input** to type and the floating keyboard for Esc, Tab and Ctrl+C.
Review each tool's permission prompts as usual.

The README demo shows the real Codex CLI with a request being composed, alongside
an actual test run in a separate session. The [mobile video](media/mobile-codex.mp4)
also shows input reaching Codex as you type, the floating keyboard and
switching back to Codex.

## Input

**Input** sends text as you type, after IME composition. Enter submits to the
terminal. Unicode input, including Korean, is supported.

In the terminal and input, **Shift+Enter** is delivered as a separate key.
Applications can use it for newlines; the running program determines its behavior.

The **⌘ button** opens a compact floating panel. Select a key and modifiers
such as Ctrl, Alt or Shift, then press **Send**. Selection alone sends nothing.
Opening the panel does not resize or rearrange the terminal. Switching sessions
clears the selected combination.

## On your phone

Swipe the terminal to browse output. Send **Esc** to return from tmux history to
input. Use **History** to read and copy recent output; it opens at the bottom.
History is bounded tmux scrollback, not a permanent log.

The native keyboard clips the visible terminal without changing its row count.
Tap the **down arrow** to hide the native keyboard while keeping Input available.

On iPhone, use **Share → Add to Home Screen** and launch the saved icon. On browsers
that support fullscreen, use **More → Fullscreen**. Font size is also in **More**.

Jelly's interface is English regardless of browser language. Project names,
session names and terminal output retain their original text.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘⇧Enter | Create and open a session in the current project. |
| ⌘⇧, | Previous session. |
| ⌘⇧. | Next session. |

Session navigation follows project/list order, skips empty projects and wraps at
the ends. New sessions receive an unused `Session N` name.
