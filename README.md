# Blueboard — local Jeopardy-style game night

Phase 4 adds individual scoring, response timers, correction history, and complete standard-game results. The game library, draft editor, media uploads, large-screen display, private iPad host controller, audio, and live-session recovery remain available. Games, media, and session progress stay on your Mac; after installation, play needs no internet or paid services.

## Start and stop

From Terminal:

```sh
cd /Users/chrisfraser/Jeopardy
./start.command
```

Open **http://localhost:3000** on the MacBook. Keep Terminal running. Press **Control-C** in that Terminal to stop. Restart with the same command. You can also double-click `start.command` in Finder.

This workspace includes installed dependencies, a built frontend, and an ignored checkout-local Node runtime. For a fresh checkout, install **Node.js 24.11 or newer** from [nodejs.org](https://nodejs.org), reopen Terminal, and run:

```sh
cd /Users/chrisfraser/Jeopardy
npm ci
npm run build
./start.command
```

After updating this existing checkout, use the local runtime if Node is not on your PATH:

```sh
export PATH="$PWD/.runtime/node/bin:$PATH"
npm ci
npm run build
```

Normal startup remains just `./start.command`; it never installs packages or contacts an external service. `npm start` is equivalent when Node is on your PATH. Node 24.11's SQLite experimental-feature notice is expected.

## Set up the MacBook display and iPad host

1. Connect the MacBook and iPad to the **same local Wi-Fi**. Open the library through **localhost on the MacBook**.
2. Save a complete game: a nonempty title and category names, plus an answer and at least one of text/image/audio in every clue. Choose **Start Game** on its library card. Draft cards offer **Check start requirements**, which lists missing items. Unsaved editor changes are not included: return to the library after saving first.
3. In the session panel, choose **Open display**. This opens `http://localhost:3000/display` in another tab. Put that tab on the TV/projector and choose **Fullscreen**. Choose **Enable Audio** on this tab once. Keep the library and private host off the projected screen.
4. In the library session panel, select the MacBook's Wi-Fi address (for example, `http://192.168.1.25:3000`). **Copy host link**, then transfer/paste the whole private link into the iPad browser. The link includes a long credential after `#`. **Do not use localhost on the iPad**: that refers to the iPad itself.
5. The display and host should both say **Connected**. Select clues on the iPad; the MacBook display follows automatically. The host always sees the correct answer. The display receives an answer only after the host reveals that clue.

The session panel shows localhost plus detected local IPv4 addresses; startup also prints available display addresses. If there are several addresses, use the one belonging to your Wi-Fi network (VPN/virtual adapters can also appear). Copy display/host link fields use the selected network address. **Open display** always uses the local MacBook origin so it can own audio. **Open host on this Mac** is useful for testing without an iPad. If copying is unavailable, select and copy the link field manually.

Treat the host link as a private controller password. Anyone with it can retrieve answers and control that session. It is sent only by the localhost setup endpoint, is removed from the host address bar after opening, and stays in that tab's session storage for refreshes. To open a second host tab or browser, copy the private link from the library again. A finished game retains its host credential for results and corrections. Starting a fresh session invalidates that credential and creates a new one. Device traffic uses local HTTP, so use a trusted local Wi-Fi network.

## Standard-game flow and judging

Before **Start Game**, configure **Use response timer for next game** in the library. It defaults to **10 seconds**, can be set to **1–120 seconds**, or disabled. This setting belongs to the new live session and cannot be changed midgame. Editing it in the library affects only the next fresh game.

The normal sequence is:

1. Select a clue. It starts with buzzing closed and its answer hidden on the display. The private host sees the correct answer.
2. Choose **Open buzzing**. Only eligible connected players can buzz. The server accepts one winner and starts that response's timer if enabled.
3. In **Judge response**, review the player, current score, clue value, and correct answer. The human host judges the spoken response; the app does not evaluate answers.
4. Choose **Correct** or **Incorrect**. If incorrect, explicitly reopen buzzing for another eligible player. If correct, the clue is resolved.
5. Reveal the answer when ready, then **Return to board**. Once all 30 clues are resolved, choose **Finish Game**.

| Host action | Result |
| --- | --- |
| Correct | Adds the clue value exactly once, stops the timer, closes buzzing, and resolves the clue; does not automatically reveal the answer |
| Incorrect | Subtracts the clue value exactly once, stops the timer, excludes that player for this clue, and leaves buzzing closed until explicitly reopened |
| Dismiss attempt — no score | Stops the timer, dismisses the accepted response without points, and keeps buzzing closed; that player remains eligible |
| Finish Without Winner | Dismisses any pending response, stops its timer, and resolves the clue without adding points; the host may reveal and return |
| Reveal answer on display | Allowed after judging/dismissing; resolves the clue and prevents further competitive buzzing for that presentation |
| Return without completing | Returns an unresolved clue to the board after any pending attempt has been judged/dismissed; it stops audio and buzzing |
| Reopen a completed clue | Explicit confirmation opens it with its answer hidden; scores/history remain, and old attempts cannot be judged again |
| Finish Game | Offered when all clues are resolved; freezes play and shows final standings |
| End session | Confirmation ends early, disables timers/buzzers, and retains final standings and history |

Every judgment belongs to a unique accepted attempt. Repeated taps, retries, reconnects, and concurrent host requests cannot score that attempt twice. Stale host actions are rejected and the current state is shown. The saved game definition remains separate and unchanged.

If everyone has attempted/been excluded, resolve the clue with **Finish Without Winner**, or explicitly reset eligibility as a correction. If eligible players are disconnected, wait for reconnection or finish the clue. Buzzing cannot be opened when no eligible players are connected.

### Response timer

The countdown starts on server acceptance of a buzz, not on opening buzzing. It appears on the host, MacBook display, and winning player's phone. The server owns the deadline; client countdowns are displays only. The host may **Pause response timer** and **Resume response timer** for the current unresolved attempt.

At expiry, the response is **timed out**, buzzing stays locked, and the host must judge it or dismiss it. **Timeout never deducts points automatically.** Old timer events cannot affect a later attempt or clue. The host cannot reveal/leave an unresolved response without explicitly judging, dismissing, or finishing that clue.

On normal Control-C shutdown, the remaining time is saved paused. After an abrupt termination, recovery estimates remaining time from the stored deadline (which may already be exhausted). Either way, an unresolved response returns with its timer paused, buzzing closed, and no automatic score change. Resume the session first, then explicitly resume its response timer if time remains, or judge/dismiss it. Session resume does not restart the timer by itself.

### Scores, corrections, and history

Every player, including a midgame arrival, starts at **$0** in a fresh session. Scores are integer dollars and may be negative. Disconnected players retain their scores. The display and host keep registration order during clues; each phone shows its own current score. Removed players retain historical records and appear in the host's scoreboard/history, but do not enter active final standings.

Open **Scoreboard & history → Scoring ledger** to see each entry's player, signed amount, reason, time, and related clue/attempt. Only the authenticated host can judge, adjust scores, control timers, or end the game. The localhost library's End session control also supplies the private host credential.

- **Adjust score:** choose a player (including a removed player when correcting history), enter a nonzero positive or negative integer, and give a required reason. A single adjustment is limited to ±$1,000,000; total scores must stay within ±$1,000,000,000. Reasons are limited to 300 characters.
- **Correct judgment:** choose an original judgment in the ledger, select the intended outcome (correct, incorrect, or dismissed), and give a reason. The app appends a reversal of that attempt's current effective score, then a replacement entry. It never deletes the original judgment. For example, changing a mistaken −$200 to a correct +$200 appends +$200 to reverse the deduction and +$200 for the intended award: a net correction of +$400.
- Corrections change **scores only**. They do not reopen clues, undo completion, reset exclusions, or create a new response opportunity. If play must resume, separately reopen the clue and, if appropriate, reset eligibility. Reopening itself never reverses points. A newly accepted response is a new attempt; an old attempt cannot be scored again.

Judgment, ledger entry, timer stop, and clue progress are committed atomically. Corrections may also be made after finishing; final standings update accordingly. Starting fresh clears the live board/scores/attempts while preserving the saved game and historical ledger/player/attempt/result records in SQLite. The current host history view is scoped to the current session; an archive-browsing interface is not included.

### Finishing and ties

After all clues are resolved, **Finish Game** shows score-ranked standings. Use **End session** with confirmation to finish early. Disconnected active players still rank; removed players do not. Equal scores share a rank (for example, 1, 1, 3), and ties for first show **Joint winners**. With no active players, results say so explicitly.

Results remain on the display, host, and registered phones across refreshes and server restarts until a fresh session starts. Joining and buzzing are closed and timers/audio are stopped. Existing credentials can view those finished results; starting a fresh session invalidates old host/player credentials and links for entering the new game. Use **Start Game** on a saved complete game in the library to start fresh at zero.

## QR joining and phone buzzers

After starting a game, the MacBook display shows a **player QR code** and readable join URL. The QR is generated entirely locally by a bundled dependency. It uses a detected non-loopback IPv4 address, never localhost. If several addresses appear, use **Player QR network address** on the private host to choose the MacBook's Wi-Fi interface. VPN/virtual adapters may also appear; choose the address reachable from your phones. If no suitable address is detected, no QR is generated. A stale saved address is not used for a public QR after the server address changes.

1. Connect every phone to the same local Wi-Fi as the MacBook and iPad.
2. Scan the player QR or type its readable URL. This is a **public player link**, separate from the private host link. Never share the private host link with players.
3. Enter your name or nickname and tap **Join game**. Names are normalized and trimmed on the server, limited to 24 characters, and compared without case differences. Empty/control-character names are rejected. If a name is already used, choose another (for example, add an initial). Removed names remain reserved for that session. Up to 64 registrations are allowed per session, including removed players.
4. Keep that phone page open. It shows your name, connection state, and a large buzzer. Wait for **Buzzing open** and tap once. Early taps are discarded; they are never queued for when buzzing opens.
5. A successful winning buzz shows **You buzzed first**; everyone else sees **Another player buzzed first** and the winning name. The display highlights that name while keeping the clue visible. The human host uses Correct or Incorrect to judge the spoken response.

The host can **Open joining / Close joining**. Closing joining affects new registrations only: already registered players can reconnect and continue. **Hide player QR / Show player QR** changes only its visibility on the display and does not leave the clue or open/close joining. A known link still works while joining is open even if its QR is hidden.

Each phone receives a random session-scoped credential. The browser saves it in local storage; the server stores its hash in SQLite. Refreshing or reconnecting restores the same player without submitting their name again, even when joining is closed. A name alone cannot recover or take over an identity. Use the same browser and the same join-link origin; private browsing, clearing storage, or changing to another MacBook IP/origin can lose access to that browser's credential. In that case, ask the host for help and join with a new unique name. The host can remove the abandoned registration; removed names stay reserved until a fresh session.

Only **one tab per player** is an active buzzer. Additional tabs using that browser credential show a read-only warning. Closing or disconnecting the active tab lets a remaining tab take its place. All attempts are checked by player identity and window ID, so multiple tabs cannot provide extra attempts. Do not share your browser credential.

The phone uses text as well as visual cues for waiting, closed/open buzzing, first/other-player wins, exclusion, and disconnection. It needs no vibration, browser audio, or wake lock. Keep the screen awake yourself during play. Disconnected/ineligible buzzers are disabled. Taps are never automatically submitted or replayed after reconnection.

### Host buzzer controls

Every newly selected clue starts with buzzing **closed**. Only the authenticated host can change it. Controls appear in **Players & buzzers**, with a connected/disconnected roster and explicit removal confirmation.

| Action | Result |
| --- | --- |
| Open buzzing | Creates a fresh server-issued window for eligible players; requires an open, unrevealed clue and no existing winner |
| Close buzzing | Stops accepting taps; a later open creates a different window ID |
| Clear accidental buzz & reopen | Clears the winner and opens a fresh window; that player stays eligible |
| Exclude winner & reopen | Eligibility-only correction: excludes that player without points and reopens for eligible connected players. Use Incorrect when recording an incorrect response. If nobody remains eligible and connected, buzzing stays closed |
| Reset clue eligibility… | Explicit confirmation clears the winner and all exclusions and **closes** buzzing; open it again manually |
| Remove player | Explicit confirmation permanently invalidates that credential for the session; removing the current winner also clears the winner and closes buzzing |

Exclusions survive later buzzer windows and returning to/reselecting that same clue. Selecting a different clue resets eligibility. Revealing an answer or completing/returning from a clue closes buzzing. An accepted winner stays visible through answer reveal; completion/return clears it. Finished sessions disable buzzing and show results. Old links/credentials cannot join or access a fresh session.

The server accepts the **first valid buzz received**, synchronously persists one winner, and closes that window before processing another attempt. It validates credentials, active-tab ownership, player eligibility, current clue, and window ID. Duplicate, early, stale, removed-player, unauthorized, and closed-window attempts are rejected. **Wi-Fi latency and device/browser scheduling can influence arrival order**; there is no promise of physical-tap simultaneity or latency compensation. Client timestamps do not decide the winner.

## Audio and images

Clue images preserve their aspect ratio. Text, an image, and audio can be combined.

Sound plays **only on the designated MacBook display**. The host has Play/Pause/Replay buttons but no audio player. Click **Enable Audio** on the desired display through localhost to satisfy browser playback rules. A silent, muted clip unlocks the player; clue audio never starts automatically. The host shows audio readiness, playback state, and errors.

Only one connected display can own audio. To move sound to another MacBook display tab, choose **Release Audio** in the current tab or close it, then enable the other tab. A second tab cannot take ownership while the first is connected. Non-local display pages cannot claim audio. Refreshing/reconnecting the display releases audio ownership; click Enable Audio again. Other public display tabs remain silent.

Play/Pause/Replay are short-lived commands for the current clue and revision, not stored playback instructions. They are deduplicated, expire quickly, and are not replayed after a reconnect. Leaving a clue, ending a session, or losing the display connection stops its audio. On connection loss this occurs when the browser detects the loss. A server restart always resets audio to stopped. If playback fails, the host receives a message; re-enable audio on the MacBook or return to the board. Editing the saved game cannot replace a damaged file in a running snapshot; end and start a new session after editing if needed.

## Resume after a connection problem or server restart

- Refreshing a display or host reloads the current authoritative session, including the current clue, revealed answer state, and completed clues. The host credential in that tab survives refreshes.
- When disconnected, controls stop accepting actions and the screen shows its connection status. Keep the server running and reconnect to Wi-Fi; Socket.IO reconnects and requests the current snapshot. There is no offline queue of host actions.
- Player roster, credentials, scores, ledger, current-clue exclusions, and any accepted winner survive a server restart. Connected status is rebuilt from live connections. Buzzing is closed and the previous window ID is invalidated; it never reopens automatically.
- After stopping/restarting the server, progress is preserved and the session is **paused**. Open the current private host link from the MacBook library if needed, then tap **Resume session** on the host. The current clue and answer visibility are preserved. Re-enable audio on the display; it will not resume playing by itself. Open buzzing explicitly when ready. If a response is unresolved, explicitly resume its paused response timer or judge/dismiss it. Incorrect judging excludes that player and leaves buzzing closed until you reopen. Finished results need no session resume.
- Saved-game edits and deletions do not alter an ongoing session: it uses its own copied game definition and retained media IDs.

## Wi-Fi and macOS troubleshooting

- If macOS asks whether Node may accept incoming connections, allow it for this local game. If another device cannot connect, find **Firewall** in macOS System Settings and check that Node is allowed to accept incoming connections. Do not forward ports on your router or expose this server to the internet.
- Check the iPad URL begins with the MacBook's current Wi-Fi address and includes the same port. IP addresses can change when switching/rejoining networks; recopy the current link from the library.
- Guest, hotel, school, and some mesh Wi-Fi networks enable **AP/client isolation**, blocking devices from reaching one another. Use a trusted network that permits device-to-device traffic. Being on the same Wi-Fi name alone does not guarantee connectivity.
- Disconnect a VPN temporarily if it blocks local-network traffic, and check that both devices are on the same usable local network. Keep the MacBook awake and its server Terminal open during play.
- If port 3000 is busy, stop the other app or use `PORT=3001 ./start.command`. Open `http://localhost:3001` and recopy the generated links.
- The library, editor, uploads, and session-management endpoints are deliberately denied over the LAN, even from the MacBook's own Wi-Fi URL. Use localhost on the MacBook for these. The iPad should use its private `/host#…` link; phones should use the public `/join/<session-id>` link. Public display links remain available.
- For localhost-only development, use `HOST=127.0.0.1 ./start.command`; other devices cannot connect in that mode. Normal startup binds IPv4 interfaces with `0.0.0.0`.

## Edit games and media

Create a game with a title and optional description. New games have six categories and five clues per category, valued at $200–$1,000. Edit category names on the board and select a clue to edit its value, text, answer, image, and audio. Drafts can be saved even when incomplete. Dots and the ready count show progress; category names must also be filled before starting.

Choose **Save game** to persist edits. The header shows unsaved, saving, saved, or failed states. Leaving unsaved edits prompts before discarding them. **Preview clue** is read-only, keeps its answer hidden until Reveal Answer, and provides normal preview audio controls. This editor preview can play on the local MacBook; live host pages never play audio.

The sample game is clearly marked, editable, and includes 30 original example clues. It is seeded only when initializing a brand-new database; upgrading does not overwrite games or recreate a deleted sample.

| File | Allowed extensions | Maximum size |
| --- | --- | --- |
| JPEG | `.jpg`, `.jpeg` | 10 MiB |
| PNG | `.png` | 10 MiB |
| WebP | `.webp` | 10 MiB |
| MP3 | `.mp3` | 20 MiB |
| WAV | `.wav` | 20 MiB |

The UI labels these limits as MB (limits use 1,024² bytes). The server checks signatures, matching extensions, kinds, and sizes; one file per request. Filenames in storage are generated UUIDs. A valid container with unsupported/damaged encoding can still fail playback; the UI explains loading failures. No upload-directory listing is served. LAN media requests are limited to media referenced by the active snapshot; localhost retains editor access.

## Storage and backups

| Location | Contents |
| --- | --- |
| `data/games.sqlite` | Saved definitions, separate answer records, media metadata, and live-session snapshot/progress, player credential hashes, response attempts, score ledger, and final results |
| `data/games.sqlite-wal`, `data/games.sqlite-shm` | SQLite working files while running |
| `data/uploads/` | Local media files |
| `dist/` | Built frontend, regenerated by `npm run build` |

**Stop the server before backing up**, then copy the whole `data` folder. Restore it with the server stopped. Keep database and uploads together. Backups include the active session's private host credential. SQLite migration v4 adds response-attempt, append-only score-ledger, and result tables without replacing saved definitions, uploads, sessions, or players. Older sessions initialize at zero with no invented past judgments; a known accepted winner becomes an unresolved response with its timer paused. Existing snapshots recover with buzzing closed. Do not downgrade an upgraded database to an earlier-phase server. Phone credentials themselves remain in browser local storage; server backups include their hashes, the roster, and buzzer progress.

Attachments are deliberately retained when removed, replaced, abandoned in an unsaved edit, or associated with a deleted game. Live snapshots and saved definitions may still need them. There is no automatic media cleanup, so disk use can grow. Deleting `data` permanently resets the entire library and active session.

For isolated storage:

```sh
DATA_DIR=/absolute/path/to/test-data PORT=3001 ./start.command
```

## Verification and physical-device checklist

With Node on PATH (or after the local-runtime PATH command):

```sh
npm run build
npm test
npm run test:browser
```

Tests use temporary data, not your real library. Browser tests use installed Google Chrome at its standard macOS path; set `CHROME_PATH` to another Chrome/Chromium executable if needed. Screenshots go into ignored `artifacts/`. See [VERIFICATION.md](VERIFICATION.md) for actual results and limitations.

Run this checklist with your **MacBook, iPad, and at least two phones**:

1. Put all devices on the same Wi-Fi. Start a complete game with the default timer, open the MacBook display/fullscreen and private iPad host, enable display audio, and join two different names by QR. Check both phones begin at $0.
2. Select a clue, open buzzing, buzz on one phone, and judge **Correct**. Check the clue value is added once on every screen, the timer stops, the clue resolves, and you can reveal and return. Retry taps must not add more points.
3. On another clue, judge the first phone **Incorrect**. Check its deduction (including a negative total), timer stop, exclusion, and closed buzzing. Explicitly reopen, buzz on the second phone, and judge it. If nobody remains eligible/connected, check the host's explanation and Finish Without Winner option.
4. Accept another buzz, pause/resume the response timer, then let it expire. Confirm the host, display, and winning phone show timeout and **no automatic deduction** occurs. Judge or dismiss explicitly. Check an accidental-buzz clear also changes no score.
5. Use **Correct judgment** with a required reason, then a manual positive/negative adjustment. Check the original entry plus reversal/replacement remain visible and totals update. Confirm correcting a judgment does not automatically reopen the clue or reset eligibility.
6. Restart the server with an unresolved response. Check scores/history survive, the response timer returns paused, buzzing remains closed, and session/timer require separate resume actions. Verify disconnected-player scores, phone refresh/reconnect, QR joining, and image/audio playback still work.
7. Resolve unanswered clues with Finish Without Winner and finish the whole game, or end early with confirmation. Check ranked standings and joint winners after equalizing scores. Remove a throwaway player before finishing to verify exclusion from standings and retained history. Start fresh and confirm scores/progress reset while the saved game and past ledger records remain intact.

## Developer notes and scope

React/TypeScript/Vite, Node/Express, SQLite via Node, and Socket.IO. All fonts/icons/assets are local; no CDN dependency. `server/access.ts` restricts local management. `server/live.ts` owns validated revisioned actions, per-connection roles, audio ownership, and field-by-field public projections. `shared/live.ts` defines wire shapes; `src/Live.tsx` provides the setup, display, and host interfaces. `server/players.ts` owns normalized names, hashed credentials, active tabs, and atomic buzzer acceptance; `src/Party.tsx` provides local QR generation, party controls, and phone pages. `server/scoring.ts` owns attempt judgments, append-only ledger writes, timer deadlines/recovery, and standings; `src/Scoring.tsx` provides judging, countdowns, corrections/history, and final results. Public broadcasts omit host credentials and every unrevealed answer. The host credential is validated independently for HTTP private state and Socket.IO connections/actions.

Saved games, categories, clues, and media keep stable IDs and explicit order. Session snapshots live separately from game definitions; action IDs and revisions protect retries and concurrent tabs. Audio ownership/playback is memory-only. Player identities are stored separately in `session_players`. Player socket/API payloads are built independently and contain no answers (even revealed ones) or host credentials. Presence is memory-only. Successful buzzes create persistent response attempts in the same transaction as the winner/window update. Host score changes and session progress use the same transaction, with post-commit broadcasts. Score totals are derived from ledger entries. Timers use server deadlines; no client timeout event has authority.

For development, run `npm run dev:server` and `npm run dev` in separate Terminals. Vite proxies `/api` and `/socket.io` (including WebSockets) to Express. Normal startup serves all frontend, API, media, and Socket.IO traffic from one origin.

Phase 4 includes no automatic answer evaluation, Daily Doubles, Double Jeopardy, Final Jeopardy, external accounts, or cloud deployment. The human host judges spoken responses.
