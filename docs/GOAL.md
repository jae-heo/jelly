# Original backend goal

This document preserves Jelly's initial backend scope. The React web terminal and
SSH projects have since been implemented. See the [README](../README.md) for
current features and setup, and the [verification record](VERIFICATION.md) for
coverage and remaining limits.

The following was the original execution brief:

> Complete **Jelly**, a personal remote terminal service, in `/path/to/jelly`.
> Read the existing code, AGENTS.md and verification record first. Do not repeat
> completed work. Use this independent repository; do not modify sibling projects
> or unrelated services.
>
> The web UI is a later stage. This goal covers the Node.js/TypeScript backend,
> project-scoped tmux sessions, HTTP API, authenticated WebSocket input/output and
> resizing, a CLI test client, and deployment documentation. Projects register
> existing server directories. Pass paths as separate arguments, never interpolate
> them into shell commands.
>
> Use a private tmux socket and configuration. Distinguish detaching from stopping
> a session. Existing sessions must reconnect after an API restart. Process
> survival after a machine reboot is not promised. When clients compete for a
> session, the latest connection takes control.
>
> Bind local development to loopback and remote access directly to this server's
> verified Tailscale IPv4 address. Use HTTP/WebSocket within the tailnet without
> requiring Serve or HTTPS. Reject wildcard, LAN and public bind addresses.
> Validate API tokens and WebSocket Origins. Never put long-lived tokens in URLs,
> logs or Git. Provide single-use browser connection tickets. This is a personal
> service; isolation between users is outside scope.
>
> Verify and document these acceptance criteria using real tmux processes:
>
> 1. Project registration, listing, removal and path validation.
> 2. Session creation in the project directory, listing and explicit termination.
> 3. Rejection of failed authentication, invalid Origins/input and reused tickets.
> 4. Command input, Unicode output and resizing through WebSocket.
> 5. Background work survives detachment; reconnecting restores the screen.
> 6. Normal and forced API shutdown/restart preserve the same shell PID.
> 7. A new connection takes control and cleans up the old attachment.
> 8. Distinct states for natural shell exit and sessions lost after a reboot.
> 9. Memory limits and attachment cleanup for slow clients.
> 10. Documentation for startup, API contracts, Tailscale deployment, token handling
>     and scrollback limits.
>
> Where possible, run the service and verify both loopback and Tailscale access.
> Do not claim physical phone testing unless performed. Verify PTY and interactive
> application behavior without paid Codex/Claude tasks or real-account calls.
> Mark the goal complete only when implementation and verification are finished.
> Report failures and remaining limits accurately.

## Follow-up stage

Use the thin xterm.js client on a physical phone to check Korean input, scrolling,
keyboard presentation, rotation and Codex/Claude Code usability before further UI
work.
