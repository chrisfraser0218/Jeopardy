# Phase 4 verification

Completed November 10, 2026 on macOS arm64, Node.js 24.11.0, and installed Google Chrome through Playwright. All checks used temporary databases/uploads; existing `data/` games, players, sessions, and uploads were not opened for writing or replaced during verification.

## Completed checks

- `npm run check` passed TypeScript/Vite build and **12 API/migration/restart tests**.
- `npm run test:browser` passed **4 Chrome workflows**: editor/media; independent host/display/audio; QR/independent phone buzzers; and a complete standard-game scoring/timer/results workflow.
- `git diff --check` passed.
- The unchanged `./start.command` entry point was smoke-tested with temporary `DATA_DIR` and `PORT=0`. The server started, accepted disabled-timer configuration, registered a player through its LAN URL, rejected an unauthenticated game-ending request (HTTP 401), accepted the host-authorized end (HTTP 204), and retained zero-score final standings. Control-C stopped it. No test server remains running.

## Scoring and atomicity

- Correct responses awarded the snapshot clue value; incorrect responses deducted it, including negative totals. Supplying a different amount in a judgment did not override the server's clue value.
- Multiple incorrect responses on one clue deducted each player's value once, excluded those players, and left buzzing closed. No eligible-player case rejected further opening until a corrective reset or clue resolution.
- Two independent host sockets submitted concurrent judgments for one attempt: exactly one succeeded and one original judgment ledger entry was written. Retrying the accepted command was a no-op. An older attempt could not be rescored after reopening the clue.
- A fault was injected into the attempt-status update **after the ledger insert**. The transaction rolled back the ledger entry, judgment, timer/progress change, revision, and score together. Removing the injected fault allowed normal judging.
- Manual positive/negative integer adjustments required a reason. Zero, fractional, out-of-range, and blank-reason adjustments were rejected.
- Correcting judgments preserved their original entries and appended a reversal/replacement pair. Multiple corrections used the current effective amount. Corrections changed no clue completion or eligibility state.
- Midgame players started at zero. Disconnected-player adjustments survived reconnection. Removed players retained their player/ledger history and score, while final standings excluded them.
- Unauthorized display/player sockets could not judge, adjust scores, control timers, or end games. The localhost ending API additionally required the current host credential.

## Timer checks

- Accepted buzzes started a server deadline. Timer pause stored remaining time; resume issued a new deadline. Disabled timers stayed disabled. Invalid before-play timer configurations were rejected.
- Server expiry marked a pending response timed out, kept buzzing closed, and wrote **no automatic deduction**. Repeated expiry checks had no further effect.
- Old attempt IDs and obsolete deadlines could not expire a newer response. Judging, dismissing, resolving, and leaving the clue stopped the corresponding timer.
- Deterministic server-clock tests exercised pause/resume and stale events. Browser tests exercised actual countdown display and expiry.
- A real backend process was stopped and restarted with a pending timed response and earlier scored judgments. Scores, ledger, player credential, clue, and attempt survived; buzzing returned closed and the response timer returned paused with no deadline. Session resume did not restart that timer; a separate timer-resume action was required.
- Corrected scores and finished standings were then persisted through another real process restart. Finished results did not require a session resume.

## Complete browser game

Separate host, display, Alice-phone, and Bob-phone browser contexts completed a short-text **30-clue standard-game fixture** using the actual UI:

1. Configured a one-second response timer before starting and joined two players at zero.
2. Accepted a buzz, paused/resumed its timer, judged an incorrect response, checked a negative score/exclusion, explicitly reopened buzzing, and judged the other player correct.
3. Played another clue with incorrect → reopen → correct, then corrected an earlier judgment through its ledger dialog and made a manual adjustment with a reason. All score views updated.
4. Let a response time out on a third clue. Host, display, and winning phone showed expiry; points stayed unchanged. Dismissed it and resolved the unanswered clue.
5. Resolved all remaining unanswered fixture clues with Finish Without Winner and returned to the board. Finish Game became available only after all 30 were resolved.
6. Finished with equal $30 scores. Every screen showed final standings and **Joint winners: Alice & Bob**, both rank 1. Phone buzzers were disabled. Refresh retained the results.
7. Started a fresh session: progress and current ledger/attempt view reset, historical database entries remained, old live credentials were invalidated, and a newly joined Alice started at zero.

This was UI automation of host judgments, not automatic answer evaluation or spoken-answer testing. An additional API test verified early ending and exclusion of a removed high-scoring player from tied active final standings.

## Earlier-phase regressions and privacy

- Game CRUD, drafts/defaults/stable IDs, saved-game persistence, conflicts/rollback, all five media formats, range serving, upload rejection, preview failures, attachment retention, and unsaved-change prompts passed.
- Independent host/display state, fullscreen, reconnect/refresh, private answers, and single-display audio ownership passed. Play/Pause/Replay, genuine playback-error recovery, and stopping audio on leaving a clue passed.
- The final regression run exposed a late play-promise rejection after a newer pause command. It was fixed so an interrupted obsolete command cannot disable audio or report a false playback error. A deterministic delayed-promise check now covers that race.
- Local QR generation/independent pixel decoding, non-loopback QR addresses, name validation, closed joining, identity restore, observer tabs, removal, and old-session expiry passed. The eight-client/ten-window buzzer race regression still accepted exactly one winner in each window.
- Player state remained independently projected without answers, host credentials, or other player credentials. Display state continued to omit unrevealed answers and host credentials. Host ledger/history remained private.
- Existing LAN restrictions for editor, setup, uploads, and non-session media remained covered. All app assets and play traffic stayed local.

## Migration and persistence

- Versioned v4 schema migration adds response attempts, score ledger, and retained results without replacing games, uploads, sessions, or players.
- Existing v1 and v2 preservation checks passed. A separate v3 fixture retained the saved game, player credential, selected clue, and known winner; scores initialized at zero, the ledger remained empty, and the known legacy winner became an unresolved response with a paused timer. No past score judgments were invented.
- Historical player/attempt/ledger/result records remained in SQLite after starting fresh. Active queries were scoped to the new session, whose score/history began at zero/empty.
- Existing unrelated source, including `Start.txt`, was preserved.

## Screenshots and limits

Ignored `artifacts/` contains visually inspected screenshots including `scoring-host-timeout.png`, `scoring-display-timeout.png`, `scoring-phone-timeout.png`, `scoring-host-history.png`, and `scoring-final-standings.png`. Earlier editor, QR, phone, portrait/landscape host, and audio screenshots remain available.

**Not performed:** Safari, physical iPhone/Android/iPad testing, camera scanning from a TV/projector, real cross-device Wi-Fi races, audible speaker listening, or device sleep/background behavior. Browser contexts ran on this Mac even when they used its LAN address. Automated concurrency proves one accepted server winner, not fairness of real-world physical tap timing.

Use the short MacBook + iPad + two-phone checklist in [README.md](README.md) for correct/incorrect scoring, rebuzzing, timeout, correction, restart, audio, and final standings on actual devices.

Practical limits:

- Countdown displays estimate server time from received snapshots; network delay/background throttling can make the visible number slightly late. Only the server deadline controls expiry. Host judgment is still required after timeout.
- Graceful shutdown saves remaining time paused. Abrupt termination recovers from the persisted deadline, possibly with no time left; no automatic deduction occurs.
- Score corrections do not automatically reopen clues or alter eligibility. The host must make any corresponding gameplay correction explicitly.
- Finished results remain until starting fresh. Historical records persist in SQLite, but browsing previous-session archives is outside this phase's UI.
- Browser credentials are origin-specific; address/browser/storage changes can lose access to a phone's saved credential. Names alone do not restore identities. Wi-Fi/device latency influences server arrival order.
- Unused media remains intentionally retained. Node 24.11 emits its SQLite experimental-feature notice; Vite emits third-party Zod comment-annotation warnings. Builds succeed.
- No Double Jeopardy, Daily Doubles, Final Jeopardy, cloud deployment, or automatic answer evaluation was added.

## Repeat checks

```sh
cd /Users/chrisfraser/Jeopardy
export PATH="$PWD/.runtime/node/bin:$PATH"
npm run check
npm run test:browser
```

The PATH line is unnecessary with Node installed globally. Set `CHROME_PATH` if Chrome is installed elsewhere. QR/browser checks require an available non-loopback IPv4 interface. Tests use and remove their own temporary data.
