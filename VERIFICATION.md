# Phase 2 verification

Completed November 10, 2026 on macOS arm64, Node.js 24.11.0, with installed Google Chrome driven by Playwright. Tests used temporary databases/uploads; the existing `data/` library and media were not used or replaced during verification.

## Build and automated checks

- `npm run build` passed TypeScript checks and the Vite production build.
- `npm test` passed **5 tests**: the 2 Phase 1 API/persistence regressions, live-session authority/privacy/media-command coverage, a real live-session backend process restart, and a v1-to-v2 migration preservation check.
- `npm run test:browser` passed **2 Chrome workflows**: the existing editor/media regression and the new independent host/display workflow.
- `git diff --check` passed.
- `./start.command` was smoke-tested with temporary `DATA_DIR` and `PORT=0`; it started successfully, printed localhost and detected LAN display URLs, served the frontend/display, allowed public LAN session state, and returned HTTP 403 for the LAN editor API. Control-C stopped it. No test server remains running.

## Session behavior verified

- Incomplete drafts and unnamed categories cannot start; messages identify missing requirements. A complete game starts with 30 available clues. A second session is rejected while one is active.
- Starting copies the saved definition into a separate session snapshot. Editing the saved text/answer does not change the ongoing snapshot. Ending and starting fresh resets progress and rotates the host credential.
- Selecting, revealing, completing, returning without completion, explicitly reopening, and ending work. Invalid transitions are rejected. Reveal and complete are separate actions.
- Repeated command IDs do not execute twice; stale revisions cannot overwrite newer state. Malformed commands and unauthenticated display control attempts are rejected.
- Public HTTP responses and display Socket.IO state contain no host credential or unrevealed answer. Reveal adds only the current clue's answer; returning to the board removes it from the public projection.
- Private HTTP state and host Socket.IO connections require the host credential. Incorrect credentials fail. Ending invalidates the previous credential and disconnects old host subscribers.
- Actual requests through this Mac's non-loopback IPv4 address could not list/edit games, upload files, or retrieve setup credentials. Unreferenced media is denied over that address; media in the active snapshot remains accessible. A spoofed non-local Host header on a loopback connection was also denied.
- A real child backend process was stopped and restarted using the same SQLite data. Snapshot, completion progress, current clue, revealed-answer state, and credential survived; revision advanced, the session was paused, and audio ownership/playback reset. Resume was required before further controls.
- The migration test reopened a v1-shaped database with existing sample IDs, definitions, and media metadata. These were preserved, the v2 session table was added, and the sample was not duplicated.

## Browser and audio behavior verified

- Separate browser contexts played the public display and authenticated host. The host used this Mac's LAN HTTP origin (an insecure browser context), exercising the controller's compatible command-ID generation. This was traffic on the same Mac, **not a physical iPad connection**.
- Chrome decoded clue images; the host saw the answer while the display did not until reveal. Host buttons synchronized the display board and completion status.
- Fullscreen entered and exited in automated Chrome. Desktop display was checked at 1440 × 1000; host views at 820 × 1180 portrait and 1180 × 820 landscape were captured and visually inspected. The Phase 1 390 × 844 editor check still passes.
- Enable Audio worked both before selecting an audio clue (silent unlock) and while a clue was open. Play/Pause/Replay affected the designated display element. The host page had no audio element. A second display could not claim audio and stayed paused.
- Playback failures were deliberately injected: the host received a useful message and disabled audio controls; re-enabling recovered playback. Returning to the board during playback stopped the audio. Refreshing the display also stopped playback and required enabling again.
- Commands were received once, not replayed on reconnect. Socket/API checks covered play/pause/replay, audio ownership rejection, release on disconnect, and stop signals on leaving a clue.
- Refreshing host/display restored the current clue and reveal state. Simulated offline/online transitions showed disconnected/reconnecting states, disabled host actions, and synchronized the latest clue after reconnection.
- Reopening a completed clue used a confirmation dialog and hid its answer again. End-session confirmation supported cancel and confirm.
- Screenshots are saved in ignored `artifacts/`: `live-display-board.png`, `live-display-clue.png`, `live-host-portrait.png`, and `live-host-landscape.png`, alongside Phase 1 screenshots.

## Phase 1 regressions retained

Game creation, editing, deletion, defaults, incomplete draft saves, stable IDs, revision conflicts, transactional rollback, actual backend restart persistence, all five upload formats, byte-for-byte media retrieval, audio byte ranges, upload rejection, image/audio preview failures, replacement/removal without premature file deletion, answer-hidden previews, and unsaved-change warnings continue to pass. Existing source unrelated to Phase 2, including `Start.txt`, was preserved.

## Remaining physical/manual checks and limitations

- **Not performed:** Safari testing, physical iPad testing, real cross-device Wi-Fi connectivity, audible speaker playback, projector/TV output, or device sleep/background behavior. Headless Chrome loaded and controlled audio fixtures; this is not a claim of audible listening tests.
- Run the short MacBook/iPad checklist in [README.md](README.md) to verify firewall/network settings, touch controls, portrait/landscape behavior, speaker routing, reconnect, and restart recovery in your environment.
- Display audio stops on connection-loss detection; it is not instantaneous when a network silently drops. Other display tabs cannot take ownership while the existing owner is still connected. Use Release Audio or close that tab before switching.
- All network traffic is local HTTP. Use trusted Wi-Fi and keep the host link private. No internet exposure or router port forwarding is needed.
- Unused uploads are intentionally retained to protect saved games and session snapshots; disk use can grow. A running snapshot cannot be changed by an editor fix; end it and start a new session to use that fix.
- Node 24.11 emits a SQLite experimental-feature notice. Vite emits third-party Zod comment-annotation warnings; the build succeeds.
- No player joining, QR codes, buzzers, scoring, timers, special rounds, or cloud features were implemented.

## Repeat checks

```sh
cd /Users/chrisfraser/Jeopardy
export PATH="$PWD/.runtime/node/bin:$PATH"
npm run build
npm test
npm run test:browser
```

The local-runtime PATH line is unnecessary when Node is already installed globally. Browser tests expect installed Chrome at its standard macOS path; set `CHROME_PATH` for another Chrome/Chromium executable.
