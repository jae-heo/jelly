# Using Jelly

For installation and remote access, see [Setup](SETUP.md).

## Projects and sessions

Add an existing folder on the Jelly server, or select an SSH host and browse its
folders. Sessions appear beneath their project. Use **+** to create a session,
and the arrow beside a project to fold its session list.

Select a project or session, then use **More → Rename project** or
**Rename session**. Renaming changes its label; folders and running programs stay as they are.

A session is a persistent shell. Run your usual tools, including Codex or Claude
Code. Closing the browser or choosing **Disconnect** detaches your connection;
**Stop session** ends the shell and its running programs.

Opening a session on another device takes control and disconnects the previous
client. Jelly keeps the three most recently visited terminals connected across
projects. Older sessions keep running and reconnect when selected.

Sessions survive Jelly restarts, but not a reboot of the machine running the shell.
Jelly uses private tmux sockets and leaves unrelated tmux sessions alone.

## Files

Select a project, then open **More → Files**. Open a folder to browse its contents,
or a file to preview it. Use **Download** to save the original file to your device.
This works for local and SSH projects, including projects without a running session.

Text and code are shown as plain text; images and PDFs open in the viewer.
Other formats can be downloaded. Text previews are limited to 1 MiB, images and
PDFs to 20 MiB. Larger files can still be downloaded. PDF display uses your browser's
built-in viewer; use Download if your browser cannot display it.

The viewer is read-only and stays within the project folder. Symbolic links are
not shown or followed. Enable **Hidden files** to include dotfiles. Search filters
the current folder; each listing shows up to 1,000 entries.

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

Swipe the terminal to browse output. Faster swipes travel farther and keep
scrolling briefly; touch again to stop. Holding before lifting your finger stops without momentum.
Send **Esc** to return from tmux history to
input.

Use **Select text** to freeze the visible screen, then hold or drag to select text
and choose **Copy**. **Select all** selects the frozen screen. Close selection to
return to the live terminal; output continues while you select. To copy older
output, scroll to it first. This works with the screen shown by Claude Code and
other terminal apps, without relying on tmux history.

On desktop, **Option-drag** on Mac or **Shift-drag** on Windows/Linux selects
directly in the terminal, even when an app handles the mouse. Use **⌘C** on Mac, **Ctrl+C** on Windows/Linux, or
the browser's **Copy** menu. Without a selection, Ctrl+C still interrupts the app. Paste normally into **Input** or the terminal;
**Shortcuts → Paste text** lets you review text before sending it. Copy buttons
work over HTTP where supported; if the browser blocks them, use its native Copy
menu on the selected text.

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
