# Phase 6 verification

Completed November 11, 2026 on macOS arm64, Node.js 24.11.0, and installed Google Chrome through Playwright. All checks used temporary databases/uploads; existing `data/` games, players, sessions, and uploads were not opened for writing or replaced during verification.

## Completed checks

- `npm run check` passed TypeScript/Vite build and **26 API/migration/restart tests**.
- `npm run test:browser` passed **7 Chrome workflows**: editor/media; independent host/display/audio; QR/independent phone buzzers; a complete standard-game scoring/timer/results workflow; optional-round editing/media; a multiround Daily Double/Final game; and Automatic repeated attempts with editor policies, answer reveal, and audio stop.
- `git diff --check` passed.
- The unchanged `./start.command` entry point was smoke-tested with temporary `DATA_DIR` and `PORT=0`: startup, library/page retrieval, starting a single-board game with Automatic activation and its timer disabled, public state, and rejection of unauthenticated ending were checked. Control-C stopped it. No test server remains running.


## Phase 6 packaged Mac application and transfer checks

Built for **macOS arm64**, with **Electron 45.3.0**, bundled **Node 24.22.2** and **SQLite 3.53.4** confirmed from the actual utility process. The application uses the runtime's built-in SQLite; it has no separately compiled SQLite addon. No development Node is needed at runtime. `start.command` remains unchanged.

`npm run test:desktop` passed a lifecycle workflow against the **built `Jeopardy.app` executable**, using isolated Application Support substitutes, an environment PATH containing only `/usr/bin:/bin`, and no installed/development Node in that PATH:

- A fresh data folder initialized and the library loaded only after backend readiness. An unrelated HTTP server occupied the requested port; the app chose another port and left the original responder unchanged. macOS wildcard/specific-interface overlap was reproduced and fixed with probes across loopback and current local IPv4 interfaces. The final packaged test reserved the Wi-Fi interface specifically; earlier runs also covered loopback reservation.
- A second launch exited and focused the existing instance. Native close followed by Dock activation reopened the library without replacing the backend/library. This was automated native window control, not a human Dock click.
- Renderer preferences were checked: context isolation and sandbox enabled, Node integration disabled, `window.require` unavailable. An arbitrary external window request was denied. Only same-app sanitized clipboard writes and user-requested fullscreen on the local display are permitted; the packaged display actually entered/exited fullscreen and unlocked audio. There is no preload/renderer IPC bridge. Packaged localhost editor functions worked, while LAN game-management/setup endpoints returned 403.
- Both documented examples imported through the actual packaged preview/confirm UI. A native Electron download saved a JSON export and its version was verified. JSON export of the media game displayed guidance to use ZIP rather than discarding attachments.
- External browser requests were blocked while local requests remained available; library/import/export traffic stayed local. This is request-level offline simulation, not disabling the Mac's internet interface or a physical Wi-Fi test.
- Starting an active game enabled the native sleep blocker; ending the game released it. Intentional quit produced the active-game warning; cancelling retained hosting. Killing the owned backend triggered the recovery action and reopened the same session paused with buzzing closed. Confirmed quit stopped the backend (the old HTTP endpoint no longer responded). A subsequent packaged restart retained all imported games and the session.
- Native dialog return values were supplied by the test, so warning generation and cancel/confirm behavior were exercised; a person has not clicked through every macOS dialog. First-launch data-choice dialogs and the standard Save panel still need the human installation check.
- Diagnostics confirmed bundled runtime/architecture and second-launch/clean-shutdown events, without the host credential. Unexpected backend exits are logged as events; request bodies, private responses, wagers, and raw stderr are not logged.

The five added transfer/storage tests cover actual JSON/ZIP examples and round trips; media bytes and attribution; repeat/one policies; disabled Double drafts, Daily Double flags and Final definitions; separate IDs on duplicate imports; incomplete drafts; corrupt JSON/ZIP; unsupported versions/fields/policies; JSON/archive/manifest/entry/expanded limits; missing media and false content signatures; unsafe/absolute paths, duplicate paths and symlinks; local-only HTTP management; and injected commit failure after files were copied. The failure rolled back game/media rows and removed new files, leaving the existing library/uploads intact. A later export with a deliberately missing stored file failed clearly rather than producing an incomplete package.

Migration tests used isolated libraries, including a live snapshot and actual image/audio files. SQLite's backup API produced a consistent retained backup; migrated games/media and the host credential matched, the source remained intact, and attempting to migrate into the populated destination was rejected. Pre-v7 installed-storage backup retained the old schema/data before upgrade; current-version storage skipped redundant backup. Shared storage locks rejected a second host. **No real project or installed-app user library was migrated or written during tests.**

`npm audit` after patched build-tool overrides reported **zero vulnerabilities**. Packager/ZIP tooling is installed for builds; normal launch performs no package installation. Standard Node experimental-SQLite and third-party Zod annotation notices remain harmless build/runtime notices.

The release is ad hoc signed, not Developer ID signed/notarized. Code-signature verification was run locally. Finder installation, Gatekeeper approval on a newly downloaded/quarantined copy, macOS firewall approval, actual audible output, and physical-device gameplay remain manual checks.

Safari is installed and `/usr/bin/safaridriver` was attempted. Session creation was refused because **“Allow remote automation” is disabled** in Safari Settings. `npm run test:safari` recorded **one skipped test, zero Safari passes**. No automation permission was enabled. Chrome workflows use installed Google Chrome/Chromium; the desktop workflow uses Electron's Chromium, neither is Safari.

Artifacts:

- `release/Jeopardy-darwin-arm64/Jeopardy.app`
- `release/Jeopardy-mac-arm64.zip`
- `GAME_FORMAT.md`, `game-format.schema.json`, `CHATGPT_GAME_PROMPT.md`
- `examples/text-only.json`, `examples/image-audio.zip` (both importer-verified)
- Ignored screenshots: `artifacts/phase6-import-preview.png`, `artifacts/phase6-packaged-library.png`; earlier gameplay screenshots remain. Both Phase 6 screenshots were visually inspected.

Measured separately on November 11, 2026 (MiB = 1,048,576 bytes; directory totals exclude duplicate symlink targets):

| Item | Logical size | Disk allocation |
| --- | ---: | ---: |
| `release/Jeopardy-darwin-arm64/Jeopardy.app` | 256.08 MiB | 257.74 MiB |
| `release/Jeopardy-mac-arm64.zip` | 114.47 MiB | 128.05 MiB |
| `data` | 2.10 MiB | 2.26 MiB |
| `node_modules` | 391.65 MiB | 411.41 MiB |
| `.runtime` | 183.53 MiB | 194.86 MiB |

The release app/ZIP contain no user library or development runtime/dependency tree. The `data/` measurement is read-only and represents the existing development library; the installed library grows separately under Application Support. Allocation can exceed ZIP byte length due to filesystem allocation.

## Phase 5A activation, category rules, and reveals

- Manual remains the session default. Opening a standard clue stays closed in Manual and opens a fresh server window in Automatic if eligible connected players exist. Image/audio clues open immediately without waiting for playback.
- The repeat-enabled $200 fixture accepted four distinct attempts by one player: three incorrect deductions and one correct award, finishing at −$400. Every attempt had a distinct ID, fresh timer, and exactly one judgment entry. Concurrent judgments and accepted-command retries did not duplicate points. Stale taps and old-attempt judgments were rejected.
- Manual remained closed after incorrect judgments. Automatic reopened after each incorrect repeat attempt; one-attempt rules excluded the player and kept buzzing closed when nobody remained eligible. Explicit host exclusions, eligibility reset, manual closure, disconnected players, reconnection, answer visibility, resolved clues, and ending were checked. Reconnection alone did not reopen a window.
- Mixed policies worked within one game and across both boards. Saved policy changes did not alter the active snapshot. New categories defaulted to repeat; missing legacy fields migrated to one attempt and Manual. v6 migration added no attempts or score events. Earlier migration/data-retention checks remained passing.
- Correct standard and Daily Double judgments resolve and reveal atomically; incorrect judgments keep answers hidden. The Daily Double uses its wager and cannot rebuzz. Explicit Daily Double setup correction reopens as a new attempt with the answer hidden. Normal score corrections preserve resolved/revealed state.
- The dedicated browser flow used independent library, iPad-sized host, display, and phone contexts. It edited/saved both category policies, selected Automatic in setup, verified closure across refresh, repeated the four-attempt example, played audio on the final response, and checked that Correct stopped it while preserving the image/answer. Display/host refresh restored the reveal without replaying audio or points, and Return to board showed the completed tile.
- A real backend restart preserved Automatic mode, repeat policy, awarded score, resolved state, visible answer, and command retry identity. Buzzing remained closed and the session paused. A second restart with a pending response recovered its timer paused and retained earlier scores. Existing Final privacy/reveal/restart workflows passed unchanged.
- The responsive editor check caught an overflow introduced by the new policy control; its width was constrained and the browser regression rerun. The delayed audio-promise test now waits until the injected promise exists before rejecting it, avoiding a test scheduling race.

## Phase 5 rounds, wagers, and privacy

- Optional Double Jeopardy and Final definitions persist across saves/reloads, including disabled incomplete drafts. Enabled rounds alone require completeness. Double defaults are $400–$2,000. Authoring limits of one/two Daily Doubles and separate answer storage were checked.
- Legacy single-board games and active snapshots remain unchanged. A v4 active-session migration preserved player credentials, selected clue, scores, and ledger without activating newly saved optional rounds. Schema v5 retains prior data and adds round definitions, Daily Double markers, attempt kinds, and private Final submissions.
- Explicit round advancement and confirmed skipping preserve identities/scores. Joining closes after the first board; existing credentials reconnect. Future clue content and Daily Double locations are absent from public/player payloads. LAN media is unavailable until its clue is revealed.
- Daily Double tests cover negative scores, minimum/maximum/fractional wagers, correcting the player/wager before reveal, timeout without deduction, correct/incorrect scoring, no rebuzz, duplicate judgments, and explicit after-reveal correction with compensating ledger history and a paused replacement attempt.
- Final tests cover frozen positive-score eligibility, zero/max/invalid wagers, confirmed wager locking, host on-behalf reasons, explicit missing-wager zero assignment, and no-eligible-player completion.
- Private response drafts survive refresh/reconnect, use revision checks, and lock on submission or the server deadline. Late edits, wrong-session requests, foreign target fields, unauthorized controls, and blank-correct judgments are rejected. Pause/resume and early close were checked.
- Private Final judgments do not change public scores, rankings, history, or another player's view. Each individual reveal commits its response, wager, judgment, and score together. Concurrent/retried reveals score once. Revealed-result corrections append compensating entries; tied winners remain tied.
- Real backend restarts were exercised during a revealed Daily Double, Final wagering, Final responses with saved/locked text, and partial result reveals. Private state, credentials, scores, and reveals survived; timers recovered paused, buzzing closed, and explicit host resume remained necessary. Retrying a revealed result after restart did not score twice.

## Multiround browser game

Independent host, display, Alice-phone, and Bob-phone contexts used the actual UI. Alice answered a first-board Daily Double correctly for $100. After a confirmed skip into Double Jeopardy, Bob lost $100 on its Daily Double and earned $1,200 on a standard clue. The host explicitly skipped the remaining board clues into Final. Alice wagered $100 and Bob $900. Private drafts autosaved; Bob refreshed and recovered his draft; Alice locked hers. Final image/audio, designated-display playback, shared countdown pause/resume, and confirmed early close were exercised. The host judged privately, revealed Bob before Alice, and finished with both at $200. Correcting Bob's result and correcting it back retained compensating history and restored the tie.

This workflow intentionally used the confirmed skip control for remaining clues; it does not claim every clue on both boards was answered. The separate one-attempt/Manual standard-game workflow below still resolves all 30 first-board clues. Optional-round editing also covered enable/disable, retained drafts, Daily Double limits, Final text/image/WAV preview, and persistence.

## Scoring and atomicity

- Correct responses awarded the snapshot clue value; incorrect responses deducted it, including negative totals. Supplying a different amount in a judgment did not override the server's clue value.
- The explicit one-attempt/Manual fixture deducted each player's value once, excluded those players, and left buzzing closed. Repeat/Automatic behavior is covered separately above. No eligible-player case rejected further opening until a corrective reset or clue resolution.
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

- Versioned v6 migration persists category policies and adds Manual defaults to legacy active snapshots. Existing first/Double categories missing a policy retain one-attempt behavior; newly created categories use repeat. Scores, ledger records, credentials, IDs, and uploads are retained.

- Versioned v4 schema migration adds response attempts, score ledger, and retained results without replacing games, uploads, sessions, or players.
- Existing v1 and v2 preservation checks passed. A separate v3 fixture retained the saved game, player credential, selected clue, and known winner; scores initialized at zero, the ledger remained empty, and the known legacy winner became an unresolved response with a paused timer. No past score judgments were invented.
- Historical player/attempt/ledger/result records remained in SQLite after starting fresh. Active queries were scoped to the new session, whose score/history began at zero/empty.
- Existing unrelated source, including `Start.txt`, was preserved.

## Screenshots and limits

Ignored `artifacts/` contains screenshots from the current workflows. Phase 5A answer/host/phone screenshots are also generated and visually inspected. Revealed standard/Daily Double answers appear before the image, with the roster below the clue and the join panel removed during that reveal so they do not push the answer off screen. The earlier Final phone private-response and tied-results screenshots were visually inspected. Earlier visually inspected screenshots include `scoring-host-timeout.png`, `scoring-display-timeout.png`, `scoring-phone-timeout.png`, `scoring-host-history.png`, and `scoring-final-standings.png`. Earlier editor, QR, phone, portrait/landscape host, and audio screenshots remain available.

**Not performed:** Safari engine checks (automation disabled, as recorded above), physical iPhone/Android/iPad testing, camera scanning from a TV/projector, real cross-device Wi-Fi races, audible speaker listening, or device sleep/background behavior. Browser contexts ran on this Mac even when they used its LAN address. Automated concurrency proves one accepted server winner, not fairness of real-world physical tap timing.

Use the short MacBook + iPad + two-phone checklist in [README.md](README.md) for round editing, Daily Doubles, private Final submissions/reveals, restart, audio, and final standings on actual devices.

Practical limits:

- Countdown displays estimate server time from received snapshots; network delay/background throttling can make the visible number slightly late. Only the server deadline controls expiry. Host judgment is still required after timeout.
- Graceful shutdown saves remaining time paused. Abrupt termination recovers from the persisted deadline, possibly with no time left; no automatic deduction occurs.
- Score corrections do not automatically reopen clues or alter eligibility. The host must make any corresponding gameplay correction explicitly.
- Finished results remain until starting fresh. Historical records persist in SQLite, but browsing previous-session archives is outside this phase's UI.
- Browser credentials are origin-specific; address/browser/storage changes can lose access to a phone's saved credential. Names alone do not restore identities. Wi-Fi/device latency influences server arrival order.
- Unused media remains intentionally retained. Node 24.11 emits its SQLite experimental-feature notice; Vite emits third-party Zod comment-annotation warnings. Builds succeed.
- Cloud deployment, paid signing/notarization, automatic answer evaluation, and tiebreakers remain outside this phase.

## Repeat checks

```sh
cd /Users/chrisfraser/Jeopardy
export PATH="$PWD/.runtime/node/bin:$PATH"
npm run check
npm run test:browser
npm run package:mac
npm run test:desktop
npm run test:safari
```

The PATH line is unnecessary with Node installed globally. Set `CHROME_PATH` if Chrome is installed elsewhere. QR/browser checks require an available non-loopback IPv4 interface. Tests use and remove their own temporary data.
