# Verification record

Last automated verification: 2026-09-30.

## English interface (2026-09-30)

- Jelly uses one English interface, independent of browser locale. UI labels,
  accessible names, help, errors, page metadata and the home-screen manifest are
  English. New sessions default to `Session N`; existing names are not migrated.
- Backend asset checks verify the English document language, title and manifest.
  Browser workflows use the English UI while retaining Korean composition,
  Unicode paths, terminal output and user-supplied names in their fixtures.
- Setup and API docs were already English. The original goal and historical
  verification record have been translated; Korean examples remain where they
  document the input tests.

## Floating virtual keyboard (2026-09-30)

- Holding the virtual keyboard open reproduced a terminal resize from 35 to 17
  rows on both local and SSH sessions. Earlier key tests opened and closed the
  panel before the fit debounce expired, missing the application redraw.
- Virtual keys now float above the input row, outside normal layout. The panel
  is capped at 320px wide, with 28px keys and smaller spacing. Opening it or
  switching key groups leaves the terminal's position and dimensions unchanged.
- Browser regressions hold each tab open beyond the debounce, assert no resize
  messages or changed output, and repeat while reading history and while the
  native keyboard is open. A cleared-screen prompt must remain visible too.

## Session creation and virtual keyboard (2026-09-30)

- Cmd+Shift+Enter creates a session in the selected local or SSH project. Browser
  coverage checks an empty project, repeated presses, failed creation and retry,
  modal/IME exclusion, and a later project selection during a delayed response.
- The input row opens a virtual keyboard. Keys and Ctrl/Alt/Shift modifiers are
  selected before Send; selection alone produces no terminal input. Switching
  sessions clears the selection. Unsupported chords cannot be sent.
- A raw terminal probe compares virtual keys with physical keys, including
  application cursor mode, function keys, modified arrows and Alt characters.
  Tests also cover retained input focus and the 320px mobile layout.
- Physical and live-input Shift+Enter preserve the modified key (CSI 13;2u)
  through Jelly's private tmux server. A disposable SSH raw-mode probe verifies
  the same bytes remotely. Ordinary Enter remains CR. The draft input retains
  its native newline behavior; terminal-app interpretation is app-specific.
- These checks use automated browsers and temporary shells, not physical
  iPhone keyboards or paid Codex/Claude sessions.
- WebKit coverage caught touch clicks suppressed by cancelled pointer events.
  Focus preservation now cancels mouse-down instead; touch Send, modifier
  selection and unchanged input focus pass in both browser engines.
- `npm run check`, `npm test` and `npm run test:ssh` passed. Chromium passed
  all 25 scenarios; all 11 WebKit scenarios passed across the initial run and
  the corrected touch-input rerun in an isolated Playwright container.

## Output flow control and deployment lock recovery (2026-09-29)

- Browsers negotiate output acknowledgements and release more data only after
  xterm parsing completes. PTY reads pause above the pending-output threshold;
  invalid acknowledgements or a 30-second stall close the attachment, preserving
  the shell. Old tabs and the CLI retain their existing protocol.
- Real local and disposable SSH browser tests withhold acknowledgements during
  a 2 MiB flood, check that output stops, then release it and verify Unicode output,
  one continuous connection and the original shell PID. Chromium passed all 23
  scenarios, including cached sessions, resume, keyboard geometry and live input.
- Linux flock replaces directory-existence locking. Forced-termination tests
  verify immediate recovery without a child, continued exclusion while a build
  child holds the descriptor, and recovery once that child exits. Unknown legacy
  directories and symlinks are refused; the lock inode is never deleted.
- `npm run check` passed. `npm test` passed 26 backend and 8 deployment/retention
  tests; `npm run test:ssh` passed the remote lifecycle suite.
- The opt-in soak runner rotates four isolated sessions through three concurrent
  connections with delayed acknowledgements and repeated disconnects. It checks
  PIDs, empty attachment/client sets, descriptor counts, GC-retained heap and RSS
  after warm-up. CI runs 60 seconds; the duration can be extended to 24 hours.
  This does not replace physical iPhone testing or establish bounds for every
  workload. See SETUP.md for the longer-run command and scope.

## Release storage retention (2026-09-29)

- Successful deployments retain the current and previous healthy releases.
  Failed health checks and redeploying the current release preserve the recovery
  pointer. Release, deployment and cleanup operations share one lock.
- Unreferenced web chunks receive a full 30-day grace period, independent of file
  build timestamps. Reusing a chunk resets its retirement. Active and recovery
  release assets remain protected.
- Cleanup supports a dry run and validates protected pointers and metadata before
  deleting generated artifacts. Tests cover invalid metadata, external symlinks,
  unrecognized directories, untouched database files, rollback and lock contention.
- `npm run check` passed; `npm test` passed 24 backend tests and 5 deployment/retention
  tests. Production cleanup preview selected only an obsolete release and no assets.
- CI exposed an existing assertion that assumed tmux always supplies an exit code.
  Direct fixture metadata confirmed tmux itself sometimes omits it. The lifecycle
  test now compares API and tmux values, checks code 7 when supplied, and still
  requires exited state and retained history. Parsing tests independently enforce
  zero/nonzero codes and omission for unknown status.

## Workspace, SSH isolation and releases (2026-09-28)

- Workspace refreshes cancel superseded requests and reject stale responses.
  Background polling shares one pending refresh. A live terminal survives an
  `unreachable` metadata result; stopped/deleted sessions still dispose it.
- Workspace data, terminal transport and terminal geometry have separate modules.
  Existing live input, resume probes, keyboard geometry and session caching remain
  covered by browser tests.
- Remote status polling is bounded and deduplicated per host. A controlled delayed
  remote creation confirmed local creation proceeds independently and same-host
  project deletion stays ordered. Cache invalidation rejects pre-mutation results.
- Development uses loopback port 47822 and `.data/dev`. Tests build under
  `.data/test-build`. Service releases use committed source and isolated locked
  dependencies under `.data/releases`, with atomic activation and health rollback.
  Deployment tests cover rollback, retained old chunks and hash collision refusal;
  API tests cover safe serving of previous chunks.
- `npm run check` passed. `npm test`: 23 backend tests and 1 deployment test passed.
  `npm run test:ssh`: 7 passed. Chromium: 21 passed. WebKit: 6 passed.
- WebKit ran in the pinned Playwright Linux container against a disposable host
  fixture; this machine lacks native WebKit runtime libraries. GitHub Actions
  installs both browser engines and runs all suites from fresh builds.
- CI exposed the empty-server boundary after the last tmux session exits.
  `no current target` is now treated as an absent session for local and SSH
  status/stop operations, with deterministic empty-server regression coverage.
- Browser keyboard movement is simulated. Physical iPhone Chrome and home-screen
  behavior still need device verification.

## Initial public release preparation (2026-09-23)

- `npm test`: 18 passed, including integration coverage with real local tmux.
- `npm run check`: server and web TypeScript checks passed.
- `npm run test:ssh`: 6 passed using a disposable Docker SSH server.
- `npm run test:web`: 8 Chromium scenarios passed for local/SSH and mobile views.
- Credential-pattern scanning found no running-server token in files intended for
  Git. Runtime data, databases, sockets, builds and test output remain excluded.
- Physical iPhone testing was not included.

## Initial backend completion

- Ran on Node.js 24.18.0, tmux 3.2a and Linux.
- `npm test`: 18 passed: one parent integration test, 14 scenarios, two network
  policy tests and one database migration test.
- Server/web type checks passed; Chromium passed five local/SSH desktop/mobile
  scenarios. SSH tests passed five cases using real OpenSSH and tmux.
- Real node-pty and tmux checks covered:
  - Authentication and Origin rejection, invalid paths/sizes and duplicate real paths.
  - Shells in project paths containing spaces, Korean and shell metacharacters.
  - Input sent immediately after WebSocket connection surviving tmux initialization.
  - Unicode output, resizing and background work after detachment.
  - Restored screens and separate scrollback retrieval after reconnecting.
  - Connection handoff and malformed messages closing only the attachment.
  - Single-use, session-scoped browser tickets.
  - The same shell PID after normal shutdown, SIGKILL and API restart.
  - API responsiveness and reconnecting after sending 16 MiB to a stalled reader.
  - Real `top`, detachment, reconnection, resizing and return to the shell.
  - The CLI inside a real PTY, including commands and Ctrl+] detachment.
  - Natural exit (code 7), explicit stop, deletion and missing-session states.
  - Project removal preserving the original directory.
- Test databases and tmux servers were isolated under `.data/test-*` and cleaned up.
- `systemd-analyze --user verify` passed. The user service was installed and enabled;
  account lingering was checked. Restarting the deployed service preserved the
  shell PID and previous output.
- Loopback development HTTP and direct access to the deployment's Tailscale IP
  worked. The Jelly project was registered through the API; verification sessions
  were removed. Tokens, databases, dependencies and builds were ignored by Git.

## Direct Tailscale access

`JELLY_HOST=tailscale` queries the connected Tailscale daemon for this machine's
IPv4 address and binds only there, removing the Serve/HTTPS prerequisite. Network
policy tests reject wildcard, LAN and public bind addresses.

Running `scripts/enable-tailnet.mjs` verified:

- The systemd service listening on port 47821 of its Tailscale address, with no
  wildcard, loopback or LAN listener in that deployment.
- HTTP 200 from `/healthz`, HTTP 401 without credentials and authenticated project access.
- WebSocket command/output round trips with an HTTP Origin.
- Creation, termination and deletion of a verification session, plus CLI discovery
  of the active endpoint.
- An empty `tailscale serve status --json` configuration; Serve was not modified.
- Detailed results saved in the ignored `.data/tailnet-check.json`.

These automated checks originated on the server itself. A user later reported
connection refusal from another tailnet computer, then confirmed access after
allowing Jelly's port in firewalld. Remote HTTP access was user-confirmed; terminal
interaction from that remote device and physical phone usability were not separately
verified. Other services and the default tmux server were untouched.

## Initial web client

React, TypeScript, Vite and xterm.js were added at `/` on the existing server.
Playwright checks used real HTTP/WebSocket and tmux to verify:

- Invalid-key rejection, valid login and authentication after refresh.
- Project registration, session creation and command results in tmux history.
- Disconnect/reconnect and restoring the selected session after page reload.
- A separate mobile context taking control and notifying the previous desktop client.
- Korean text, paste and Enter input.
- No horizontal overflow at 390×844; input and terminal keys remaining visible at 390×520.
- Confirmed session termination and no browser JavaScript errors.
- Public HTML/assets and CSP headers, with unauthenticated API, token-file and source access denied.

Browser servers, databases and tmux were isolated in `.data/browser-test-*` and
cleaned up. Desktop/mobile screenshots were inspected. Tests did not open a real
phone OS keyboard.

After restarting the deployed service, HTML/assets/health returned HTTP 200 and
unauthenticated API requests returned 401. Chromium opened the deployment from the
server, logged in with the real key, listed the existing Jelly project, then logged
out and removed the stored key. No test session was created in existing projects.

## Server folder picker (2026-09-22)

- Authenticated `/api/directories` covered home, parent and root navigation,
  hidden directories, Korean/metacharacter paths and directory symlinks. Regular
  files, file symlinks and broken links were excluded.
- Missing authentication, invalid Origin, relative/NUL paths, absent folders,
  file paths and inaccessible folders were rejected.
- Desktop and 390px mobile checks covered browsing, path entry, filtering, hidden
  folders, empty-folder selection, reopening the previous location and preserving
  form input after navigation failure or cancellation.
- Selecting a folder populated its path and filled the project name only if empty.
  The deployed form was also checked with the home directory's `jelly` folder,
  cancelling before registration.
- Token authentication and value were unchanged. The existing session retained
  its shell PID and status after deployment.

## Agentless SSH projects (2026-09-22)

The disposable Alpine image in `test/ssh-container/Dockerfile` installed only
OpenSSH and tmux. Its SSH port was loopback-only, using temporary keys, aliases and
known_hosts. No Jelly, Node.js, Python or remote agent was installed. Checks covered:

- Multiple Host names, quoted aliases and Include files, excluding wildcard patterns.
- Authentication on the alias API, rejection of SSH flags in targets and refusal of
  unverified host keys.
- Connection checks, duplicate registrations and refusal to remove hosts with projects.
- Remote-only and hidden folders, including Korean, quotes, shell metacharacters and newlines.
- Immediate PTY input, Korean output, resizing and connection handoff.
- Background work after detachment and restored screen/history after reconnecting.
- The same remote shell PID after restarting Jelly.
- `unreachable` for an unresponsive host, without recording termination; recovery
  preserved the shell PID and output.
- Explicit stop/delete preserving project folders and unrelated tmux servers.
- Migration of SQLite project/session relationships to local/remote path uniqueness,
  with a pre-migration backup, foreign-key checks and restart verification.
- Mobile Chromium: alias listing/checking/selection, remote folder selection,
  commands, history, refresh/reconnect, stop and registration cleanup.

Temporary containers, keys and databases were cleaned up. Three concrete SSH aliases
were found in the real server's configuration; no connection or command was made to
those targets. Deployment preserved the existing project and session IDs, shell PID,
status and token. Mobile browser checks on the deployment verified the three aliases,
form population and host options without browser errors.

## Mobile terminal scrolling (2026-09-22)

- A regression test reproduced swipes leaving output unchanged before the fix.
- tmux mouse support and one-finger swipe forwarding use xterm's mouse protocol.
  Attachment updates existing local/SSH sessions, so users need not recreate them.
- Chromium touch emulation checked bidirectional swipes after 120 lines of output,
  commands after returning to the latest screen and history after reload.
- Swiping preserved input focus and outer-page position; tapping focused input.
  Mouse-wheel behavior and Esc leaving history in default/vi modes were checked.
- Local/SSH tests covered upgrading existing `mouse off` sessions on reattachment,
  initial input, unchanged shell PID and reconnection.
- Type checks, 18 backend tests, 5 SSH tests and 4 browser tests passed.

## Single workspace header (2026-09-22)

- Three header bars became one. Mobile height fell from 144px to 56px, adding 88px
  of terminal space. Desktop shows brand, project and session in one bar.
- History remains directly accessible; SSH management, disconnect, stop and full
  server paths moved into More.
- 320px/390px widths, long names and a 390×520 keyboard-sized viewport had no
  horizontal overflow and kept the menu accessible.
- Keyboard opening, Escape dismissal/focus return and outside-click dismissal passed.
- Four browser scenarios and type checks passed, including local/SSH workflows and
  bidirectional touch scrolling. Desktop/mobile screenshots were inspected.
- This historical deployment updated static files without API or tmux restart.

## Font size and compact input (2026-09-22)

- More gained a 10–24px font-size control and 14px reset. Invalid values or unavailable
  browser storage fall back to the default.
- xterm rendering changed 14→18→17→14px, PTY columns changed and reload restored
  18px. Changes preserved the WebSocket connection and shell PID.
- The footer became a 44px row without a duplicate status bar, with optional draft
  input and extra keys. Focus and Korean drafts survived hiding/reopening input.
- At 320×520, expanded input/keys had no horizontal overflow; Send and Esc remained
  accessible. Five browser scenarios and type checks passed; screenshots were inspected.

## Mobile keyboard interaction (2026-09-22)

- A regression reproduced Send losing input focus. Sending, Esc and key expansion
  now retain focus; closing input blurs it before hiding. Opening uses `preventScroll`.
- The workspace follows visual viewport height and offsetTop, coalescing resize/scroll
  events per frame. Pinch zoom retains native zoom/panning; logout removes styles.
- The original sizing implementation waited for a 120ms quiet period and avoided
  duplicate PTY sizes. Later geometry changes above supersede this behavior.
- Chromium covered Send, touch Esc, key expansion, focus dismissal, font settings,
  local/SSH scroll and reconnect behavior.
- Five-step simulated viewport animations checked header/input position, resize
  coalescing and zoom behavior. This was not a real OS keyboard animation test.
- References: [Chrome viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior),
  [VisualViewport API](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport).

## Shorter UI copy (2026-09-22)

- Login retained key entry, storage and lookup while removing introductory decoration.
  Empty states, status and SSH/folder errors became shorter; redundant hints and
  routine creation/termination notifications were removed.
- Stop consequences, file preservation and actionable errors remained. Help was
  organized by feature.
- Type checks, web build and five browser scenarios passed. Desktop/390px screenshots
  and deployed login/help/logout were checked. The existing session kept its PID
  and status; static files were updated without a service restart.

## Fullscreen and home-screen mode (2026-09-22)

- Fullscreen controls appear only when supported. The whole document enters
  fullscreen so dialogs and notifications remain visible. Browser exits and logout
  update state; viewport and safe-area handling follow the change.
- Home-screen web-app metadata and iPhone instructions were added.
- Type checks, web build and five browser scenarios passed. Chromium exercised the
  real Fullscreen API, dialogs, unchanged PID/WebSocket and logout. Simulated API
  rejection checked the error and retry path.
- Deployed HTTP fullscreen/logout and simulated unsupported-browser UI were checked.
  The existing session remained unchanged without a service restart.
- Physical Android Chrome browser/keyboard transitions and iPhone home-screen launch
  were not tested.
- References: [Fullscreen API](https://fullscreen.spec.whatwg.org/),
  [Chrome fullscreen guide](https://web.dev/articles/fullscreen),
  [WebKit home-screen apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## Lizard logo and keyboard safe area (2026-09-22)

- The SVG became a four-legged lizard with a curled tail, used on login, desktop
  and the favicon. Mobile shows a 30px logo in the existing list toggle, keeping
  its 44px touch target and 56px header.
- Input focus plus substantial viewport height reduction identifies a keyboard.
  Bottom safe-area padding disappears while open and returns on dismissal. Focus
  alone with a hardware keyboard, or pinch zoom, leaves it intact. Width changes
  reset the baseline; logout cleans up styles.
- Chromium reproduced a stale 34px bottom inset before the fix. Tests then verified
  34→0→34px, restoration while input stayed focused, and existing input/fullscreen/scroll.
- Type checks, web build and five browser scenarios passed. After disabling input
  autocorrection and CSS cleanup, checks/build and one input scenario passed again.
- Deployed SVG, 320/390/1440px layouts and mobile list toggling were inspected.
  The existing session retained PID/status without service restart.
- Physical iPhone keyboards were not inspected. `autocorrect=off` was added, but
  hiding the iOS arrows/Done accessory bar was not implemented.
- References: [WebKit safe-area issue](https://bugs.webkit.org/show_bug.cgi?id=217754),
  [W3C discussion of iOS input accessories](https://lists.w3.org/Archives/Public/public-webapps-github/2026Sep/0121.html).

## Additional mobile terminal keys (2026-09-22)

- The original 44px accessory row contained Esc, Tab, Ctrl+C, paste, Enter and Ctrl+R;
  only the keys scrolled horizontally. Expanded navigation, Ctrl and function keys
  used a two-row grid. The later virtual keyboard replaces this layout.
- Arrows and Home/End respect xterm application cursor mode. Function keys match
  xterm sequences. The original custom Ctrl input accepted one Latin letter.
- A raw-input program in temporary tmux compared virtual/physical key bytes for
  normal/application cursor modes, paging, delete, Shift+Tab, Ctrl and function keys.
- Paste added no Enter. Custom Ctrl input, focus, PID preservation and 320×520 access
  were checked; screenshots of all three key groups were inspected.
- Type checks, web build and six browser scenarios passed, including local/SSH scroll,
  keyboard safe area and fullscreen. These do not replace physical iPhone testing.

## Separate draft sending from submission (2026-09-22)

- Send and Enter in the draft input paste only the draft; the terminal Enter key
  submits it. Help and README were updated.
- A raw-input probe checked Korean drafts and keyboard submission without an appended
  Enter, including a trailing control-character marker to detect delayed input.
  Terminal Enter sent one CR and kept draft focus.
- Type checks and web build passed. Four browser scenarios passed initially; a tap
  in an SSH context without touch support was corrected to click, then SSH/workspace
  scenarios passed again.
- Deployed HTML/JS/CSS matched the new build without a service restart.

## Korean product naming (2026-09-22)

- The Korean product name was standardized as 줼리 in UI, accessibility labels,
  browser/home-screen titles, docs, setup scripts, tests and AGENTS.md.
- The registered `/path/to/jelly` project was renamed in a transaction, preserving
  its ID, path and session records. The API reflected the change.
- Type checks, 18 backend tests and one workspace browser scenario passed. Source
  and builds were checked for old spellings, and deployed assets were verified.
- Mobile browser checks covered titles, logo, key help, registered project and host
  selector. No real user session was attached and the service was not restarted.

## Home-screen lizard icons (2026-09-22)

- The SVG generated opaque, padded PNGs at 180, 192 and 512px. Apple touch metadata
  and a manifest with the product name, standalone display and icons were added.
  `npm run build:icons` regenerates them.
- Only those three icons and the manifest joined the public asset allowlist.
  Integration checks covered unauthenticated GET/HEAD, MIME types, actual PNG sizes,
  cache policy and continued privacy of other files.
- Type checks and 18 backend tests passed. Icons were inspected; the deployment's
  login page metadata and browser decoding of all three PNGs were verified.
- Restart preserved the existing session's PID/status; public assets matched the build.
  Actual iPhone installation was not checked; older installed icons may need re-adding.
- References: [Apple home-screen icons](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html),
  [WebKit home-screen icons](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## SSH switching latency (2026-09-22)

- Ticket issuance, WebSocket validation and PTY attachment previously opened separate
  SSH connections. Read operations and attachments now reuse OpenSSH transports,
  with private sockets keyed by host, port, identity and configuration. The original
  idle timeout was 60 seconds.
- Explicit checks use fresh connections for host-key/authentication verification;
  mutations also use separate connections. Pausing a disposable SSH server exposed
  queued stop requests executing after recovery; the fix preserved the existing PID.
- Alternating two sessions six times measured ticket-to-ready medians of about
  427→35ms for warm SSH and 17→13ms locally. This was a loopback Docker fixture,
  excluding physical iPhone/Tailscale latency and first-time SSH authentication.
- Type checks, 18 backend, 6 SSH and 6 browser tests passed. Coverage included shared
  transport, independent input, detach isolation, master loss/recovery, server pause,
  API restart, host-key rejection and local/SSH scrolling.
- Deployment preserved two running session PIDs and statuses.
- Reference: [OpenSSH connection reuse](https://man.openbsd.org/ssh_config#ControlMaster).

## Browser session cache (2026-09-23)

- Instead of rebuilding xterm/WebSocket on every selection, the original cache kept
  the three most recent sessions in a project. Selecting the active session does
  not reconnect. Later work extends the cache across projects.
- Hidden terminals send no input, resize or automatic reconnect. Returning applies
  current dimensions and reconnects if needed; a takeover waits for explicit
  Reconnect. Desktop focus moves to the visible terminal.
- Local/disposable SSH tests blocked new tickets while switching and observed no
  added tickets/WebSockets. Input isolation, hidden sizes, takeover and recovery
  after hidden transport loss passed.
- Visiting a fourth session evicts only the oldest attachment. Reopening preserves
  its shell PID/output. Disconnecting or stopping one session leaves other cached
  connections intact; logout closes all attachments.
- Type checks, web build and eight browser scenarios passed. Desktop focus changes
  were followed by separate SSH and local switching/focus checks. Desktop pointer
  behavior was modeled through matchMedia in a mobile Chromium context.
- Deployed assets were verified without restarting the service or attaching user sessions.
- Slower iPhone home-screen behavior than Chrome was not reproduced directly.
  These checks establish removal of connection/render setup for cached switches;
  first visits, cache misses and page restarts still require a connection.

## Live input and Korean composition (2026-09-23)

- A default 44px live-input row sends typing without a separate Send button. Mobile
  terminal taps focus it; swipes retain scrolling. Dismissing the keyboard leaves
  the row visible. The pencil switches to draft input.
- React does not rewrite the native capture value. During composition, the final
  Korean character is withheld while committed text is sent in order. Keyboard
  updates without composition events hold the final character for 300ms and send
  subsequent edits as deletion/replacement.
- Pending composition commits before Enter, Ctrl, arrows or paste. Paste adds no
  Enter. Focus changes reset tracking so stale input cannot erase new terminal
  content; disconnect, session switch and unmount cancel timers.
- A raw tmux probe inspected received bytes. Chromium's IME API composed
  `ㅎ→하→한`, `한글` and `간→가나`; pending Jamo stayed unsent after a 360ms pause.
  Tests covered Enter/Ctrl+C ordering and duplication, eventless composition/edits,
  ASCII/emoji deletion, input after paste, mobile Enter without keydown and session isolation.
- SSH tests executed a command entered through browser IME. Existing key, scroll,
  font, safe-area, fullscreen and cache coverage passed. Type checks/build passed;
  eight browser scenarios passed initially, then the accessory-row height assertion
  was corrected to exclude its border and input/SSH checks passed again. Nine
  scenarios were verified, with a 320×520 screenshot inspected.
- Actual iPhone IME events and keyboard reopening were not tested. Native Chromium
  composition and simulated events do not substitute for iOS device testing.
- References included local Orca mobile source and
  [Orca live input and Korean edits](https://github.com/stablyai/orca/pull/7273).
  Jelly's browser component requires no additional remote installation.

## Returning from the background (2026-09-23)

- The three cached terminals have no time limit. This change reduces the wait until
  input works after app resume, rather than adding screen storage.
- Resume probes apparently open connections with a unique nonce, retaining healthy
  transports and replacing those without a response within 1.2 seconds. Stalled
  connection attempts are cancelled/restarted; ticket, WebSocket and terminal-ready
  setup has an overall 12-second deadline.
- Healthy probes preserve input state/focus, delivering queued input after response.
  Stale events cannot affect replacements. Hidden sessions probe when selected;
  explicit disconnects and device takeovers remain respected.
- SSH idle reuse increased from 60 seconds to 20 minutes, verified with `ssh -G`.
  A policy version in socket names avoids reuse of masters with the old timeout.
  Mutating commands continue to use separate connections.
- Chromium simulated stale OPEN sockets against real local/container SSH terminals.
  Resume-to-ready measured 1,862ms locally and 1,863ms over SSH. Healthy reuse,
  input/focus preservation, deduplicated wake events, stalled tickets, detach/takeover
  semantics, unchanged PIDs and input were checked.
- Type checks, 19 backend tests, 6 SSH tests and 11 browser scenarios passed. API
  probes, invalid nonce rejection and probes never reaching terminal input were checked.
- Deployment restart preserved the running shell's PID/status and matched public
  assets to the build, without attaching or typing into the user's terminal.
- Measurements used simulated local resume/failure events, not a physical iPhone
  suspended for ten minutes or a real-time measurement of the 20-minute idle expiry.

## Limits

- Physical phone Korean IME, keyboards, rotation and touch scrolling remain unverified.
- No real-account or paid Codex/Claude Code tasks were run. Shells and a real fullscreen
  TUI (`top`) were tested.
- Slow-consumer and soak tests cover specific scenarios and durations; they do not
  prove a strict memory bound for all workloads.
- Running processes do not survive a reboot of their host.
- Jelly serves one trusted token holder. It is not a sandbox that isolates users.
