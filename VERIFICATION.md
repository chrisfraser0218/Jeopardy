# Phase 3 verification

Completed November 10, 2026 on macOS arm64, Node.js 24.11.0, and installed Google Chrome via Playwright. All automated checks used temporary databases/uploads. Existing `data/` games and media were not opened for writing or replaced during verification.

## Completed checks

- `npm run check` passed: TypeScript/Vite production build and **8 API/migration/restart tests**.
- `npm run test:browser` passed **3 Chrome workflows**: the Phase 1 editor/media regression, Phase 2 independent host/display/audio regression, and Phase 3 independent phone/QR/buzzer workflow.
- `git diff --check` passed.
- `./start.command` was tested with temporary `DATA_DIR` and `PORT=0`. It printed localhost/LAN URLs, started a session (HTTP 201), registered a player through its LAN address (HTTP 201), and returned a safe player snapshot with buzzing closed. Control-C stopped it. No test server remains running.

## Joining and identity

- Server trimming/normalization and name validation passed: blank, overlong, and control-character names were rejected; case/outer-whitespace duplicates were rejected with a choose-another-name message.
- Closing joining rejected new registrations while existing credentials still restored their original players. Opening joining allowed new registrations.
- The browser restored a player's name/identity after refresh, including while joining was closed. Duplicate names did not take over an existing player.
- Credentials were random, session-scoped, and at least 43 URL-safe characters. SQLite contained credential hashes rather than those raw player credentials. Wrong, name-only, removed, and expired credentials failed authentication.
- Multiple tabs sharing a credential had one active buzzer socket; observer tabs could not buzz. Disconnecting the active socket promoted a remaining tab without creating another attempt for the same identity/window.
- Player removal required UI confirmation, could be cancelled, invalidated open sockets and credentials, and remained effective after refresh and a real backend restart.
- Ending a session disabled its players. Old credentials and join links could not access/join a fresh session.
- A name containing `<b>…</b>` rendered as literal text on the phone and roster, without creating markup.

## Buzzer authority and eligibility

- Opening/selecting a clue began with buzzing closed. Only the authenticated host could open/close it.
- Eight independent socket clients raced in **10 successive windows** (80 attempts): **exactly one successful acknowledgment and one persisted winner per window**.
- Early/closed attempts, repeated winner taps, old window IDs, duplicate-tab attempts, unauthorized display attempts, and supplied client timestamps were rejected. Reopening issued a new server window ID; no rejected early attempt became a winner later.
- A clear-accidental-buzz action preserved the former winner's eligibility. Excluding the winner prevented their later attempts across reopened windows for that clue.
- Explicit eligibility reset cleared winner/exclusions and closed buzzing. Returning/reselecting the same clue retained exclusions; selecting a different clue reset eligibility.
- Answer reveal and clue completion closed buzzing and disabled later attempts.
- Player reconnect/offline tests did not submit or replay a buzz when the phone came back online. Disconnected and ineligible phone controls were disabled.

## QR, display, and host browsers

- The bundled local QR generator produced the actual display image. The browser test read its pixels and decoded them with an independent test-only QR decoder. The decoded URL matched the active session's non-loopback LAN address and contained no host credential.
- Host QR address selection was restricted to detected non-loopback addresses; localhost, loopback, and arbitrary external origins were rejected. No public QR is generated from a stale/unavailable address or a server explicitly bound only to loopback.
- The QR was shown/hidden while the current clue stayed selected and visible. Closing joining left existing phone identities connected.
- Three separate phone browser contexts used the Mac's ordinary LAN HTTP origin at 390 × 844. They joined, raced, refreshed, handled exclusion/reset, displayed first/other-player wins, and handled removed/expired sessions. An additional same-identity tab was read-only.
- The MacBook display showed a compact roster and a prominent first-buzz name while retaining the clue. Host roster management and buzzer actions synchronized to the phones and display.
- Phone screenshots and host/display screenshots were captured and visually inspected. Ignored artifacts include `player-buzzer-open.png`, `player-first-buzz.png`, `player-display-qr-winner.png`, and `player-host-controls.png`.
- Phone pages contained no audio element and required no vibration or wake lock.

## Privacy, storage, and recovery

- Player HTTP/socket state was independently projected: no answer fields (including revealed answers), host credentials, or other player credentials were present. Public display state continued to omit unrevealed answers and host credentials; authenticated host state retained private answers.
- Existing LAN editor/setup/upload restrictions and host authorization checks still passed.
- A real child backend process was stopped/restarted after an accepted winner and an exclusion. Player identities/credential hashes, removed status, current clue, exclusions, and winner survived. The session resumed paused, audio was stopped, all old buzzing windows were invalidated, and buzzing stayed closed after Resume until the host explicitly acted.
- The backend was also restarted while a buzzer window was open: it returned closed, with exclusions preserved.
- The v1 migration check retained saved definitions/media metadata and added the new schema without reseeding the sample. A separate v2 active-session upgrade check retained the saved game, session ID, host credential, and open clue while adding safe paused/closed-buzzer defaults.
- Tests did not alter existing games, uploads, or unrelated `Start.txt` content.

## Earlier-phase regressions

The existing checks continue to pass for game CRUD, drafts/defaults/stable IDs, saved-game restart persistence, revision conflicts and rollback, all five media upload formats and byte ranges, upload rejection, safe media retention on replacement/removal, preview failures, hidden/revealed answers, unsaved-change warnings, independent host/display synchronization, fullscreen, reconnect/refresh recovery, single-display audio ownership, Play/Pause/Replay, playback-error recovery, and stopping audio when leaving a clue. Host portrait/landscape and editor narrow-page checks remain covered.

## Remaining physical/manual checks and limitations

- **Not tested:** Safari, physical iPhone/Android phones, physical iPad, camera scanning from a TV/projector, cross-device Wi-Fi connectivity, actual speaker sound, real Wi-Fi race timing, or device sleep/background behavior. All browser checks were headless Chrome on this Mac, even when they used its LAN address. Socket concurrency proves one accepted server winner; it does not measure real-world tap fairness.
- Run the **MacBook + iPad + at least two phones** checklist in [README.md](README.md) for camera scanning, touch controls, firewall/client isolation, audio routing, repeated near-simultaneous real taps, reconnects, and restart behavior.
- Wi-Fi latency, device scheduling, and browser behavior affect arrival order. Client timestamps do not decide the winner. Buzzing closes when a valid arrival is accepted, not when a physical tap occurs.
- Browser identity is stored per origin. Changing browser/storage or the Mac's address can lose access to that browser's credential; names alone cannot restore identities. Removed names remain reserved, and the registration limit is 64 including removed players.
- Multiple tabs may compete to become the active tab after reconnecting; only one can buzz. Close unwanted tabs if your preferred tab reports that another tab is active.
- Network-loss detection is not instantaneous. Buzzers disable when the browser detects disconnection; buffered/early/stale taps are not replayed into a later window.
- Local HTTP requires trusted Wi-Fi and private handling of host/player credentials. No external service, internet dependency during play, or router port forwarding is needed.
- Unused uploads are still intentionally retained. A running snapshot must be ended/restarted to use later editor fixes.
- Node 24.11 emits its SQLite experimental-feature notice; Vite emits third-party Zod comment-annotation warnings. The build succeeds.
- No scoring, response timers, Daily Doubles, Double Jeopardy, Final Jeopardy, or cloud deployment was added.

## Repeat checks

```sh
cd /Users/chrisfraser/Jeopardy
export PATH="$PWD/.runtime/node/bin:$PATH"
npm run check
npm run test:browser
```

The PATH line is unnecessary if Node is installed globally. Browser checks expect installed Chrome at its standard macOS path; set `CHROME_PATH` for another Chrome/Chromium executable. The QR/browser test requires a detected non-loopback IPv4 interface; it does not silently replace its QR with localhost.
