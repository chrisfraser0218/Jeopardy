# Blueboard — local Jeopardy-style game night

Phase 6 adds an Apple Silicon Mac application, portable game import/export with media, and storage/lifecycle safeguards. Manual/Automatic buzzing, category attempt policies, and automatic answer reveals remain available. Optional Double Jeopardy and private Final Jeopardy wagering/responses remain available. The game library, draft editor, media uploads, large-screen display, private iPad host controller, audio, and live-session recovery remain available. Games, media, and session progress stay on your Mac; after installation, play needs no internet or paid services.

## Install and launch Jeopardy.app

The built application is `release/Jeopardy-darwin-arm64/Jeopardy.app`. The installation archive is `release/Jeopardy-mac-arm64.zip`. Unzip it in Finder, drag **Jeopardy.app** to **Applications**, and double-click. Only the MacBook installs the app; iPad and phones use browsers. Normal launch needs no Terminal, Node installation, dependency install, rebuild, internet, account, or subscription. The app bundles Electron, Node, SQLite, the backend, and frontend for this Mac's **arm64** architecture. The interface continues to use the Blueboard name. The release app measures 256.1 MiB of file contents (257.7 MiB disk allocation); the ZIP is 114.5 MiB. User data and development dependencies are separate; see VERIFICATION.md for measurements.

This is a local, **ad hoc signed, not Developer ID signed or notarized** build. macOS may warn on opening a downloaded unsigned app. After attempting to open it, use the app-specific **Open Anyway** action in System Settings → Privacy & Security, as described in [Apple’s opening instructions](https://support.apple.com/en-ie/102445). Do not disable Gatekeeper or other system-wide protections. If your Mac's managed policy forbids unsigned applications, ask its administrator. No signing service was purchased and nothing was published.

The app confirms backend readiness before opening the library. It checks the preferred port (3000) and chooses a free port if occupied, leaving unrelated processes alone. **Use the links shown in this running app**, which contain the actual port; do not assume 3000. A second launch focuses the existing window. Use **Window → Open display** or the library's Open display link for the MacBook screen; enable audio on that display once. The copied private iPad host link and public phone QR use your selected current Wi-Fi address.

**Closing the last window keeps hosting running.** Click the Dock icon or **Window → Open library** to reopen. **Jeopardy → Quit Jeopardy / Command-Q** stops hosting and its backend; during an active game it asks before quitting. Progress recovers paused on the next launch, buzzing closed, timers paused, and audio stopped. Keep the MacBook awake, plugged in, and **lid open**. Idle system/display sleep is prevented while a game is active, but the app does not make closed-lid hosting work.

If the backend fails, use **Restart hosting** in the recovery dialog or Help menu. Devices disconnect briefly; saved state returns paused. Resume explicitly on the host, re-enable display audio, and open buzzing/resume timers as needed. Recovery never replays audio, phone submissions, or score actions. **Help → Open diagnostics** reveals `logs/application.log` in the app's data folder; it records startup/exit/version/port events without host tokens, request bodies, player answers, or wagers. Startup errors suggest storage/permissions/free-space checks and offer retry/diagnostics.

## Installed storage, migration, and updates

Installed data lives at **`~/Library/Application Support/Jeopardy/`**: `games.sqlite`, `uploads/`, `logs/`, retained `backups/`, and Chromium profile files. It stays outside the app bundle and survives replacing the application. Development continues to use `/Users/chrisfraser/Jeopardy/data/` (or an explicit separate `DATA_DIR`). A process lock prevents two hosts writing the same data folder; development rejects the installed app's standard storage path. Stop the relevant host before manually inspecting or backing up its data. Never remove a lock while its process is alive.

On first installed launch, choose a separate fresh library or **Copy existing data…**, selecting the old `data` folder. Quit the development server first. Migration uses SQLite's backup API (not a blind copy of an active database), copies managed media, validates database integrity/references and saved boards, and only then publishes the new library. The source and a consistent backup remain. It never overwrites an existing destination database or uploads folder. If both libraries already exist, keep both: export games from the old local library and import them into the installed app. Session/history migration is a whole-library first-launch copy; game import intentionally does not transfer private live state. No real user data was migrated during automated verification.

Before upgrading an existing installed database's schema, the bundled backend makes and validates a database/media backup under `backups/before-v7-…/`. Migration backups use `backups/migration-…/`. Do not delete originals/backups until you have independently checked your games/media. Schema v7 adds optional media-attribution storage; prior scores, attempts, credentials, and settings are retained.

To rebuild an update from this checkout, install build dependencies once if needed, then run:

```sh
export PATH="$PWD/.runtime/node/bin:$PATH"
npm ci
npm run package:mac
```

Quit the old application, replace only `Jeopardy.app` in Applications, and reopen. **Do not replace or delete Application Support data.** The build is local and makes no automatic updater/network requests. Keep the project and its development data separate. The release ZIP contains the application, not your library, backups, or development dependencies.

## Import and export games

In the MacBook library, **Import Game** accepts version-1 JSON or ZIP packages. Review title, enabled rounds, category names, clue/media counts and draft warnings, then **Confirm import**. Cancel leaves the library unchanged; previews expire after ten minutes. Each confirmed import creates a separate new game with new internal IDs, even if the title matches. Existing games and the live session stay intact. Invalid files produce an error and are not partially added.

Each game card offers **Export JSON** and **Export ZIP**. JSON is for text-only games. ZIP includes `manifest.json` and every referenced image/audio file, including disabled optional-round drafts. If attachments exist, JSON export explains that ZIP is required; it never silently removes them. Missing files must be repaired before exporting a complete package. Unused uploads are retained locally but are not exported. Attribution travels with media. Exports include definitions, answers, drafts, Daily Doubles, optional rounds, and category policies; they exclude sessions, players, credentials, wagers, responses, scores/history, and the Manual/Automatic session-start choice.

The Help menu’s **Game format and examples** action reveals copies bundled for offline reference. See [GAME_FORMAT.md](GAME_FORMAT.md), [JSON Schema](game-format.schema.json), [verified JSON example](examples/text-only.json), [verified image/audio ZIP](examples/image-audio.zip), and [reusable ChatGPT prompt](CHATGPT_GAME_PROMPT.md). ZIP import rejects unsafe paths, symlinks, duplicate entries, unsupported types/versions, mismatched contents, and missing attachments, with bounded archive/expanded/file sizes. It never fetches remote assets or executes imported text.

## Development start and stop

From Terminal:

```sh
cd /Users/chrisfraser/Jeopardy
./start.command
```

For development, open **http://localhost:3000** on the MacBook. Keep Terminal running. Press **Control-C** in that Terminal to stop. Restart with the same command. You can also double-click `start.command` in Finder.

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

1. Connect the MacBook and iPad to the **same local Wi-Fi**. Open Jeopardy.app, or the development library through **localhost on the MacBook**.
2. Save a complete game: a nonempty title and category names, plus an answer and at least one of text/image/audio in every clue of each enabled round. Choose **Start Game** on its library card. Draft cards offer **Check start requirements**, which lists missing items. Unsaved editor changes are not included: return to the library after saving first.
3. In the session panel, choose **Open display**. This opens `http://localhost:3000/display` in another tab. Put that tab on the TV/projector and choose **Fullscreen**. Choose **Enable Audio** on this tab once. Keep the library and private host off the projected screen.
4. In the library session panel, select the MacBook's Wi-Fi address (for example, `http://192.168.1.25:3000`). **Copy host link**, then transfer/paste the whole private link into the iPad browser. The link includes a long credential after `#`. **Do not use localhost on the iPad**: that refers to the iPad itself.
5. The display and host should both say **Connected**. Select clues on the iPad; the MacBook display follows automatically. The host always sees the correct answer. The display receives an answer only after the host reveals that clue.

The session panel shows localhost plus detected local IPv4 addresses; startup also prints available display addresses. If there are several addresses, use the one belonging to your Wi-Fi network (VPN/virtual adapters can also appear). Copy display/host link fields use the selected network address. **Open display** always uses the local MacBook origin so it can own audio. **Open host on this Mac** is useful for testing without an iPad. If copying is unavailable, select and copy the link field manually.

Treat the host link as a private controller password. Anyone with it can retrieve answers and control that session. It is sent only by the localhost setup endpoint, is removed from the host address bar after opening, and stays in that tab's session storage for refreshes. To open a second host tab or browser, copy the private link from the library again. A finished game retains its host credential for results and corrections. Starting a fresh session invalidates that credential and creates a new one. Device traffic uses local HTTP, so use a trusted local Wi-Fi network.

## Standard-game flow and judging

Before **Start Game**, configure **Use response timer for next game** in the library. It defaults to **10 seconds**, can be set to **1–120 seconds**, or disabled. This setting belongs to the new live session and cannot be changed midgame. Editing it in the library affects only the next fresh game.

Choose **Buzzer activation for next game** before starting. **Manual** (the default) requires the host to open buzzing. **Automatic** opens immediately when a standard text, image, or audio clue appears and reopens after an incorrect judgment when eligible connected players remain. It does **not** wait for audio playback to finish. Daily Doubles and Final keep their special participation rules. The mode is frozen in the session; the host controller shows it. Close buzzing keeps it closed until an explicit reopening or a fresh gameplay transition. Refresh/reconnect never opens it; restart always closes buzzing and requires explicit host action.

Each first-board and Double-board category has a **Category attempt policy** in the editor beside the selected clue:

- **Repeat attempts allowed**: players can buzz again after an incorrect response, losing the clue value for every distinct incorrect attempt. New categories default to this policy.
- **One attempt per player**: an incorrect response excludes that player for the remainder of the clue, useful for true/false and other two-answer categories. Existing categories and active snapshots missing a policy migrate to this setting to preserve their prior behavior.

Policies belong to categories and are copied into the session snapshot. Editing the saved game does not change a running session. Explicit host exclusions apply under either policy. For example, three incorrect $200 attempts followed by a correct fourth attempt produce −$600 + $200 = **−$400** from zero. Each needs a fresh tap in a new server-issued window; taps are never queued or replayed.

The normal sequence is:

1. Select a clue. Its answer starts hidden. Buzzing stays closed in Manual mode and opens immediately in Automatic mode when an eligible connected player is available. The private host sees the correct answer.
2. In Manual mode, choose **Open buzzing**. Only eligible connected players can buzz. The server accepts one winner and starts that response's timer if enabled.
3. In **Judge response**, review the player, current score, clue value, and correct answer. The human host judges the spoken response; the app does not evaluate answers.
4. Choose **Correct** or **Incorrect**. Incorrect applies the category policy; Manual keeps buzzing closed, while Automatic opens a fresh window if eligible connected players remain. Correct resolves the clue and automatically reveals its answer.
5. After Correct, the clue, image, and revealed answer stay visible, and audio stops. Choose **Return to board** when ready. Manual answer reveal remains available for unanswered clues. When the board is resolved, explicitly advance to the next enabled round, or choose **Finish Game** if no round remains. Final Jeopardy finishes after every eligible result is revealed.

| Host action | Result |
| --- | --- |
| Correct | Adds the clue value exactly once, stops the timer, closes buzzing, resolves the clue, reveals its answer, and stops clue audio; presentation stays until Return to board |
| Incorrect | Subtracts the clue value exactly once, stops the timer, applies the category attempt policy, and opens a fresh window only in Automatic mode when eligible connected players remain; never reveals the answer |
| Dismiss attempt — no score | Stops the timer, dismisses the accepted response without points, and keeps buzzing closed; that player remains eligible |
| Finish Without Winner | Dismisses any pending response, stops its timer, and resolves the clue without adding points; the host may reveal and return |
| Reveal answer on display | Allowed after judging/dismissing; resolves the clue and prevents further competitive buzzing for that presentation |
| Return without completing | Returns an unresolved clue to the board after any pending attempt has been judged/dismissed; it stops audio and buzzing |
| Reopen a completed clue | Explicit confirmation opens it with its answer hidden; scores/history remain, and old attempts cannot be judged again |
| Finish Game | Offered after the last enabled board is resolved when no Final remains; freezes play and shows standings |
| End session | Confirmation ends early, disables timers/buzzers, and retains final standings and history |

Every judgment belongs to a unique accepted attempt. Repeated taps, retries, reconnects, and concurrent host requests cannot score that attempt twice. Stale host actions are rejected and the current state is shown. The saved game definition remains separate and unchanged.

For standard clues, if everyone is excluded by the category rule or host, resolve the clue with **Finish Without Winner**, or explicitly reset eligibility as a correction. If eligible players are disconnected, wait for reconnection or finish the clue. Buzzing cannot be opened when no eligible players are connected. A later reconnect alone does not reopen it; the host can choose Open buzzing.

### Response timer

The countdown starts on server acceptance of a buzz, not on opening buzzing. It appears on the host, MacBook display, and winning player's phone. The server owns the deadline; client countdowns are displays only. The host may **Pause response timer** and **Resume response timer** for the current unresolved attempt.

At expiry, the response is **timed out**, buzzing stays locked, and the host must judge it or dismiss it. **Timeout never deducts points automatically.** Old timer events cannot affect a later attempt or clue. The host cannot reveal/leave an unresolved response without explicitly judging, dismissing, or finishing that clue.

On normal Control-C shutdown, the remaining time is saved paused. After an abrupt termination, recovery estimates remaining time from the stored deadline (which may already be exhausted). Either way, an unresolved response returns with its timer paused, buzzing closed, and no automatic score change. Resume the session first, then explicitly resume its response timer if time remains, or judge/dismiss it. Session resume does not restart the timer by itself.

### Scores, corrections, and history

Every player, including a midgame arrival, starts at **$0** in a fresh session. Scores are integer dollars and may be negative. Disconnected players retain their scores. The display and host keep registration order during clues; each phone shows its own current score. Removed players retain historical records and appear in the host's scoreboard/history, but do not enter active final standings.

Open **Scoreboard & history → Scoring ledger** to see each entry's player, signed amount, reason, time, and related clue/attempt. Only the authenticated host can judge, adjust scores, control timers, or end the game. The localhost library's End session control also supplies the private host credential.

- **Adjust score:** choose a player (including a removed player when correcting history), enter a nonzero positive or negative integer, and give a required reason. A single adjustment is limited to ±$1,000,000; total scores must remain safe integer dollar amounts. Reasons are limited to 300 characters.
- **Correct judgment:** choose an original judgment in the ledger, select the intended outcome (correct, incorrect, or dismissed), and give a reason. The app appends a reversal of that attempt's current effective score, then a replacement entry. It never deletes the original judgment. For example, changing a mistaken −$200 to a correct +$200 appends +$200 to reverse the deduction and +$200 for the intended award: a net correction of +$400.
- Corrections change **scores only**. They do not reopen clues, undo completion, reset exclusions, or create a new response opportunity. If play must resume, separately reopen the clue and, if appropriate, reset eligibility. Reopening itself never reverses points. A newly accepted response is a new attempt; an old attempt cannot be scored again.

Judgment, ledger entry, timer stop, and clue progress are committed atomically. During Final, manual adjustments wait until all results are revealed; revealed Final judgments can still be corrected. Corrections may also be made after finishing; final standings update accordingly. Starting fresh clears the live board/scores/attempts while preserving the saved game and historical ledger/player/attempt/result records in SQLite. The current host history view is scoped to the current session; an archive-browsing interface is not included.

### Finishing and ties

After the last board is resolved with no Final remaining, **Finish Game** shows score-ranked standings. If Final is enabled, all eligible results must be revealed first. Use **End session** with confirmation to finish early. Disconnected active players still rank; removed players do not. Equal scores share a rank (for example, 1, 1, 3), and ties for first show **Joint winners**. With no active players, results say so explicitly.

Results remain on the display, host, and registered phones across refreshes and server restarts until a fresh session starts. Joining and buzzing are closed and timers/audio are stopped. Existing credentials can view those finished results; starting a fresh session invalidates old host/player credentials and links for entering the new game. Use **Start Game** on a saved complete game in the library to start fresh at zero.

## Optional round editing

Open a saved game in the editor and use **Enable Double Jeopardy** or **Enable Final Jeopardy**, then select the corresponding **Edit…** tab. Existing games remain single-board games until you enable more rounds. Disabling a round retains its draft content and media; completeness checks apply only to enabled rounds.

- The first board stays six categories × five clues with its existing values.
- A new Double Jeopardy board defaults to six categories × five clues worth **$400, $800, $1,200, $1,600, $2,000**. Names, individual values, text, image, audio, answers, previews, and draft saving work as on the first board.
- Mark **Daily Double** in a clue editor: at most **one on the first board** and **two on Double Jeopardy**. They are optional. The editor disables additional marks at the limit, and the server validates it too. Boards containing a Daily Double need a highest value of at least $5.
- Final Jeopardy has one category and one clue, with an answer and optional image/audio. It uses the same clue editor and preview; its wager replaces a fixed clue value during play.

Save before starting. The library's ready/total count includes enabled rounds. A running session keeps its copied definition, even if you enable, disable, or edit rounds in the library later. Existing active-session snapshots are not upgraded into extra rounds.

## Round progression

The display and host show the current round. Players and scores carry forward. Once a board is resolved, choose **Advance to next round**; scores are not reset. **Skip remaining clues & advance…** requires confirmation and resolves the remaining clues without points before advancing. On the last board without another round, **Skip remaining clues — no score…** resolves it and returns to the board; choose Finish Game explicitly afterward.

Joining permanently closes when the first board ends. Already registered players can reconnect throughout later rounds. Starting a fresh session is required to admit a new roster after that point. Results are not shown while another enabled round remains.

## Daily Double play

Selecting a Daily Double shows an announcement while its clue stays hidden. Normal buzzers are disabled, including before reveal.

1. On the host, identify the nonremoved player who physically chose the clue.
2. Enter and **Confirm Daily Double wager**. The allowed integer range is **$5 through the greater of that player's score or the highest configured value on the current board**. Zero and negative scores still get the board's maximum. The host shows the range and the server enforces it.
3. Before revealing, you may change the player (which clears the wager) or confirm a different wager. Choose **Reveal Daily Double clue** only when setup is correct.
4. The selected player responds alone; the normal response timer starts if enabled. Correct adds the wager; incorrect subtracts it. Either judgment resolves the clue, and other players cannot rebuzz. Correct automatically reveals the answer and stops audio, awarding the wager once; Incorrect keeps the answer hidden. Timeout still requires a host judgment and never deducts automatically.

**Correct Daily Double setup after reveal…** is an explicit, reasoned workflow. It compensates any existing judgment on that attempt (or records the dismissed pending attempt), changes player/wager, reopens this clue as a new accepted attempt, and pauses its new timer if enabled. The pre-Daily-Double score is used for correction limits. Judge that new attempt or explicitly resume its timer. Old attempts remain in history and cannot be judged twice. After leaving the clue, normal ledger corrections/manual adjustments remain available; they do not automatically redo play.

The regular accidental-buzz/eligibility controls are for standard clues. A Daily Double can instead be skipped without points or judged; its location is never sent in future public clue data.

## Final Jeopardy

### Category and private wagers

Final is optional. At entry, the server freezes eligibility and starting scores: **nonremoved players with a positive score** participate, including disconnected players. Others keep their scores and can view results. If nobody qualifies, Final is skipped and standings appear. Eligibility is frozen, so player removal is disabled during Final.

Only the category is shown during wagering. Each eligible phone enters an integer wager from **$0 through its frozen starting score**, then confirms it. Confirmed wagers cannot be changed. Each phone sees only its own private wager; the host sees submission status and values. The board and other phones see counts, not private wagers.

For an unavailable phone, the host may enter that player's wager with a required recorded reason. Before revealing the clue, every eligible player must have a wager. **Assign missing wagers to $0…** is a separate explicit confirmation action that records the host's decision; nothing silently fills them in.

### Clue, shared timer, and private responses

Choose **Reveal Final clue & start 30 seconds**. The clue/image is shown and a shared server-authoritative 30-second countdown begins. The host alone controls attached audio, which plays only on the designated MacBook display. No theme music or external media is required or included.

Eligible players type their responses on their phones. Drafts autosave after a short typing pause; **Save response draft** also saves immediately. Watch the visible **Unsaved / Saving… / Saved / Locked** state. Only the latest **server-saved** text can be locked at the deadline. **Submit final response** requires confirmation and locks the response early. A disconnected phone cannot submit; check saved state after reconnecting. Responses are limited to 5,000 characters and remain private to their player and host until revealed.

The host may pause/resume the shared timer. **Close Final responses early…** requires confirmation and locks the latest saved drafts. At server expiry, every latest saved draft locks automatically, including blanks. Late edits and wrong-stage submissions are rejected. Pausing the timer freezes time; players may still edit while the session is running. After a restart, the session and shared timer require explicit resumption; a recovered exhausted timer requires the host to close responses and judge.

### Private judging and chosen reveal order

After responses lock, the human host judges each correct or incorrect. Blank responses must be incorrect. Judgments may be changed privately before that player's reveal; they have not yet changed a score or written a scoring entry.

Choose **Reveal [player]'s result** in any order. That action reveals the response, wager, judgment, and resulting score together, and commits that wager's score change exactly once through the ledger. Before a player's reveal, their public score is unchanged and their response/wager/outcome is absent from public/player views. There is no premature ranking or history entry to reveal an unrevealed judgment.

After a result is public, use the existing **Correct judgment** workflow with a reason for compensating entries. Final corrections must remain correct/incorrect, and a blank cannot become correct. During partial reveals, only already revealed Final judgments can be corrected; other score adjustments wait until Final finishes. Every eligible result must be revealed before final standings appear. Ties remain joint winners; there is no tiebreaker.

Ending early is still possible with confirmation. Only already committed/revealed scores are counted; unrevealed Final judgments are abandoned without points. Starting fresh invalidates previous live credentials, resets play, and preserves historical records in SQLite.

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
- After stopping/restarting the server, progress is preserved and the session is **paused**. Open the current private host link from the MacBook library if needed, then tap **Resume session** on the host. The current clue and answer visibility are preserved. Re-enable audio on the display; it will not resume playing by itself. Open buzzing explicitly when ready. If a response is unresolved, explicitly resume its paused response timer or judge/dismiss it. After resuming, incorrect judging follows the frozen category policy and activation mode; merely resuming the session does not open buzzing. Finished results need no session resume.
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

The UI labels these limits as MB (limits use 1,024² bytes). The server checks signatures, matching extensions, kinds, and sizes; one file per request. Filenames in storage are generated UUIDs. A valid container with unsupported/damaged encoding can still fail playback; the UI explains loading failures. No upload-directory listing is served. LAN media requests are limited to the currently revealed clue presentation; future media and special-round clues stay unavailable until revealed. Localhost retains editor access.

## Storage and backups

| Location | Contents |
| --- | --- |
| `data/games.sqlite` | Saved definitions, separate answer records, media metadata, and live-session snapshot/progress, player credential hashes, response attempts, score ledger, and final results |
| `data/games.sqlite-wal`, `data/games.sqlite-shm` | SQLite working files while running |
| `data/uploads/` | Local media files |
| `dist/` | Built frontend, regenerated by `npm run build` |

**Stop the server before backing up**, then copy the whole `data` folder. Restore it with the server stopped. Keep database and uploads together. Backups include the active session's private host credential, Final wagers, and response drafts. SQLite migration v7 adds media attribution; v6 adds category policies and legacy Manual activation defaults; the earlier v5 migration adds round definitions/answers, Daily Double flags/attempt kinds, and private Final submissions without replacing saved definitions, uploads, sessions, players, or the ledger. Sessions predating scoring initialize at zero with no invented past judgments; Phase 4 scores and ledger entries are preserved; a known accepted winner becomes an unresolved response with its timer paused. Existing snapshots recover with buzzing closed. Do not downgrade an upgraded database to an earlier-phase server. Phone credentials themselves remain in browser local storage; server backups include their hashes, the roster, and buzzer progress.

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
npm run test:desktop # after npm run package:mac
npm run test:safari  # requires Safari Allow remote automation
```

Tests use temporary data, not your real library. Browser tests use installed Google Chrome at its standard macOS path; set `CHROME_PATH` to another Chrome/Chromium executable if needed. Screenshots go into ignored `artifacts/`. See [VERIFICATION.md](VERIFICATION.md) for actual results and limitations.

Run this checklist with your **MacBook, iPad, and at least two phones**:

1. Create or edit a game with a repeat-attempt category and a one-attempt true/false category on both boards, both optional rounds enabled, one first-board Daily Double, up to two Double-board Daily Doubles, and a Final category/clue. Add an image/audio clip to a special clue, preview, save, restart, and confirm the definition persists. Also confirm an old single-board game still starts unchanged.
2. First start in Manual mode: confirm clue selection and incorrect judgments keep buzzing closed. Then start a fresh Automatic session, connect the iPad host and two phones, and enable audio on the MacBook display. In the repeat category, answer a $200 clue incorrectly three times with fresh taps, then correctly: confirm −$400, four attempts, automatic reopening, answer/image staying visible, and stopped audio. Return to board. In the one-attempt category, verify first-incorrect exclusion. Manually close buzzing, refresh/reconnect a phone, and confirm it stays closed. Select a Daily Double: confirm the clue is hidden and all phone buzzers are disabled. Choose its player and valid wager, reveal, test timeout/pause/resume, then judge. Incorrect must resolve it without letting the other phone rebuzz.
3. Advance or confirm skipping to Double Jeopardy. Check the current-round label, carried scores/identities, closed joining, and existing-player reconnection. Exercise the explicit Daily Double setup-correction workflow and inspect compensating history.
4. Enter Final with positive player scores. Confirm only the category appears. Submit $0/max wagers on the phones and verify neither phone sees the other's wager. Test a host-entered wager with a reason or assign missing wagers to $0 explicitly.
5. Reveal the Final clue. Check image proportions and host-controlled audio only from the MacBook. Type and save private drafts on both phones, refresh one phone, submit/lock one response early, and let the shared timer expire or explicitly close it early. Check the latest Saved drafts lock and late edits are rejected.
6. Judge privately. Verify public scores and the other phone reveal nothing about unrevealed outcomes. Reveal players in your chosen order, confirm each score changes once, correct a revealed judgment with a reason, and verify final standings/joint winners only after all results are revealed.
7. Stop/restart during a Daily Double, Final wagering, Final responses, and after one result reveal. Confirm private state and committed scores survive, timers return paused, buzzing stays closed, and explicit host actions resume play without duplicate submissions or awards.

## Developer notes and scope

React/TypeScript/Vite, Node/Express, SQLite via Node, and Socket.IO. All fonts/icons/assets are local; no CDN dependency. `server/access.ts` restricts local management. `server/live.ts` owns validated revisioned actions, per-connection roles, audio ownership, and field-by-field public projections. `shared/live.ts` defines wire shapes; `src/Live.tsx` provides the setup, display, and host interfaces. `server/players.ts` owns normalized names, hashed credentials, active tabs, and atomic buzzer acceptance; `src/Party.tsx` provides local QR generation, party controls, and phone pages. `server/scoring.ts` owns attempt judgments, append-only ledger writes, timer deadlines/recovery, and standings; `src/Scoring.tsx` provides judging, countdowns, corrections/history, and final results. `shared/rounds.ts`, `server/rounds.ts`, and `src/Rounds.tsx` add round selection, special-clue controls, private Final projections/submissions, and reveal transactions. Optional-round answers are stored separately from presentation definitions. Public broadcasts omit host credentials and every unrevealed answer. The host credential is validated independently for HTTP private state and Socket.IO connections/actions.

Saved games, categories, clues, and media keep stable IDs and explicit order. Session snapshots live separately from game definitions; action IDs and revisions protect retries and concurrent tabs. Audio ownership/playback is memory-only. Player identities are stored separately in `session_players`. Player socket/API payloads are built independently and contain no answers (even revealed ones) or host credentials. Presence is memory-only. Successful buzzes create persistent response attempts in the same transaction as the winner/window update. Host score changes and session progress use the same transaction, with post-commit broadcasts. Score totals are derived from ledger entries. Timers use server deadlines; no client timeout event has authority.

For development, run `npm run dev:server` and `npm run dev` in separate Terminals. Vite proxies `/api` and `/socket.io` (including WebSockets) to Express. Normal startup serves all frontend, API, media, and Socket.IO traffic from one origin.

Phase 6 includes no automatic answer evaluation, tiebreaker, external accounts, paid services, or cloud deployment. The human host judges spoken responses.

## Game-night checklist

1. Launch Jeopardy.app on the MacBook, confirm Connected, select the current Wi-Fi address, and keep the lid open. Allow incoming local connections for Jeopardy if macOS asks; avoid guest-network/client isolation or VPN routes. If no Wi-Fi address appears, connect and refresh. If the address changes, select a current address on the host and share the regenerated links/QR; the app does not silently end the session. Browser credentials are origin-specific, so changing address/port may require the original phone origin or host help.
2. Open the MacBook display and enable audio. Put only that display on the TV/projector. Copy the **private host link** to the iPad; keep it off the projected screen. Both should show Connected.
3. Have two phones scan the **public player QR**, enter distinct names, and keep their browser tabs open. Confirm the roster and reconnection behavior. Actual scanning/device Wi-Fi behavior still needs this physical check.
4. Check image readability and audible audio from only the designated MacBook display. Test Manual activation, then a fresh Automatic session. Manually close/reopen; verify repeated deductions in a repeat category and exclusion in a one-attempt category. Correct must reveal the answer until Return to board; Incorrect must keep it hidden.
5. Verify scores, a Daily Double's selected player/wager, round progression, private Final wagers/drafts, shared timer, host judgment and chosen reveal order. Confirm unrevealed outcomes stay private and standings appear after all reveals.
6. Reconnect a phone/iPad; confirm scores and identity. Quit with Command-Q, confirm stopping, and check devices disconnect. Next launch should recover paused with closed buzzers and stopped audio. Do not close the MacBook lid while hosting.
