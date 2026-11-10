# Blueboard — local Jeopardy-style game night

Phase 3 adds individual player joining by local QR code and phone buzzers. The game library, draft editor, media uploads, large-screen display, private iPad host controller, audio, and live-session recovery remain available. Games, media, and session progress stay on your Mac; after installation, play needs no internet or paid services.

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

Treat the host link as a private controller password. Anyone with it can retrieve answers and control that session. It is sent only by the localhost setup endpoint, is removed from the host address bar after opening, and stays in that tab's session storage for refreshes. To open a second host tab or browser, copy the private link from the library again. Ending a session invalidates the credential; a fresh session gets a new one. Device traffic uses local HTTP, so use a trusted local Wi-Fi network.

## Host controls

| Action | Result |
| --- | --- |
| Select an available clue | Opens it with the display answer hidden |
| Reveal answer on display | Shows the answer; does **not** complete the clue |
| Mark complete & return | Stops audio, removes the clue's value from the display board, and returns to the board |
| Return without completing | Stops audio and returns the clue to the available board |
| Reopen a completed clue | Requires an explicit confirmation; opens it again with the answer hidden |
| End session | Requires confirmation and clears live progress; saved game definitions remain unchanged |

Invalid controls are disabled. Only one clue can be open at a time. If multiple hosts act at once, the server checks the session revision: a stale action is rejected and the current state is shown. Review the board before trying again after an error or missing acknowledgment.

One session can be active at a time. The library panel provides the current host link to continue that session or an **End session** option. Starting another game requires ending the existing session. Starting fresh resets all 30 clue positions while preserving the saved definition.

## QR joining and phone buzzers

After starting a game, the MacBook display shows a **player QR code** and readable join URL. The QR is generated entirely locally by a bundled dependency. It uses a detected non-loopback IPv4 address, never localhost. If several addresses appear, use **Player QR network address** on the private host to choose the MacBook's Wi-Fi interface. VPN/virtual adapters may also appear; choose the address reachable from your phones. If no suitable address is detected, no QR is generated. A stale saved address is not used for a public QR after the server address changes.

1. Connect every phone to the same local Wi-Fi as the MacBook and iPad.
2. Scan the player QR or type its readable URL. This is a **public player link**, separate from the private host link. Never share the private host link with players.
3. Enter your name or nickname and tap **Join game**. Names are normalized and trimmed on the server, limited to 24 characters, and compared without case differences. Empty/control-character names are rejected. If a name is already used, choose another (for example, add an initial). Removed names remain reserved for that session. Up to 64 registrations are allowed per session, including removed players.
4. Keep that phone page open. It shows your name, connection state, and a large buzzer. Wait for **Buzzing open** and tap once. Early taps are discarded; they are never queued for when buzzing opens.
5. A successful winning buzz shows **You buzzed first**; everyone else sees **Another player buzzed first** and the winning name. The display highlights that name while keeping the clue visible. There is no scoring or correct/incorrect judgment in this phase.

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
| Exclude winner & reopen | Clears the winner, excludes that player for this clue, and opens for remaining eligible players; if nobody remains eligible, buzzing stays closed |
| Reset clue eligibility… | Explicit confirmation clears the winner and all exclusions and **closes** buzzing; open it again manually |
| Remove player | Explicit confirmation permanently invalidates that credential for the session; removing the current winner also clears the winner and closes buzzing |

Exclusions survive later buzzer windows and returning to/reselecting that same clue. Selecting a different clue resets eligibility. Revealing an answer or completing/returning from a clue closes buzzing. An accepted winner stays visible through answer reveal; completion/return clears it. Ended sessions disable every phone, and old links/credentials cannot join or access a fresh session.

The server accepts the **first valid buzz received**, synchronously persists one winner, and closes that window before processing another attempt. It validates credentials, active-tab ownership, player eligibility, current clue, and window ID. Duplicate, early, stale, removed-player, unauthorized, and closed-window attempts are rejected. **Wi-Fi latency and device/browser scheduling can influence arrival order**; there is no promise of physical-tap simultaneity or latency compensation. Client timestamps do not decide the winner.

## Audio and images

Clue images preserve their aspect ratio. Text, an image, and audio can be combined.

Sound plays **only on the designated MacBook display**. The host has Play/Pause/Replay buttons but no audio player. Click **Enable Audio** on the desired display through localhost to satisfy browser playback rules. A silent, muted clip unlocks the player; clue audio never starts automatically. The host shows audio readiness, playback state, and errors.

Only one connected display can own audio. To move sound to another MacBook display tab, choose **Release Audio** in the current tab or close it, then enable the other tab. A second tab cannot take ownership while the first is connected. Non-local display pages cannot claim audio. Refreshing/reconnecting the display releases audio ownership; click Enable Audio again. Other public display tabs remain silent.

Play/Pause/Replay are short-lived commands for the current clue and revision, not stored playback instructions. They are deduplicated, expire quickly, and are not replayed after a reconnect. Leaving a clue, ending a session, or losing the display connection stops its audio. On connection loss this occurs when the browser detects the loss. A server restart always resets audio to stopped. If playback fails, the host receives a message; re-enable audio on the MacBook or return to the board. Editing the saved game cannot replace a damaged file in a running snapshot; end and start a new session after editing if needed.

## Resume after a connection problem or server restart

- Refreshing a display or host reloads the current authoritative session, including the current clue, revealed answer state, and completed clues. The host credential in that tab survives refreshes.
- When disconnected, controls stop accepting actions and the screen shows its connection status. Keep the server running and reconnect to Wi-Fi; Socket.IO reconnects and requests the current snapshot. There is no offline queue of host actions.
- Player roster, credentials, current-clue exclusions, and any accepted winner survive a server restart. Connected status is rebuilt from live connections. Buzzing is closed and the previous window ID is invalidated; it never reopens automatically.
- After stopping/restarting the server, progress is preserved and the session is **paused**. Open the current private host link from the MacBook library if needed, then tap **Resume session** on the host. The current clue and answer visibility are preserved. Re-enable audio on the display; it will not resume playing by itself. Open buzzing explicitly when ready. If a winner was already accepted, use Clear accidental buzz or Exclude winner before reopening.
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
| `data/games.sqlite` | Saved definitions, separate answer records, media metadata, and the separate live-session snapshot/progress, and player credential hashes |
| `data/games.sqlite-wal`, `data/games.sqlite-shm` | SQLite working files while running |
| `data/uploads/` | Local media files |
| `dist/` | Built frontend, regenerated by `npm run build` |

**Stop the server before backing up**, then copy the whole `data` folder. Restore it with the server stopped. Keep database and uploads together. Backups include the active session's private host credential. SQLite migration v3 adds a separate player table without replacing saved definitions or uploads. Existing Phase 2 snapshots are upgraded with buzzing closed and paused recovery. Do not downgrade an upgraded database to an earlier-phase server. Phone credentials themselves remain in browser local storage; server backups include their hashes, the roster, and buzzer progress.

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

1. Put all four devices on the same Wi-Fi. Start the server, allow firewall access if prompted, start a complete game, and open the MacBook display fullscreen. Enable Audio there.
2. Open the private host link on the iPad. Confirm its portrait/landscape controls are comfortable. Choose the correct player QR network address, then scan the display QR on both phones.
3. Join with two different names. Try a duplicate with different capitalization/outer spaces and check the rejection. Close joining, refresh an existing phone (it should restore), and try registering a new player (it should be blocked).
4. Select an image/audio clue. Verify image proportions and actual MacBook speaker sound, Play/Pause/Replay, and silence on the phones/iPad. Hide/show the QR while the same clue stays visible.
5. Check both phones start with buzzing closed. Open buzzing and tap both phones as close together as you can. Exactly one name should win; both phones and the board should agree. Repeat several times with Clear accidental buzz. Real Wi-Fi order can differ from perceived tap order.
6. Exclude a winner and reopen. Check that phone stays ineligible across several windows while the other can buzz. Explicitly reset eligibility, then verify a different clue starts with everyone eligible. Reveal an answer and confirm buzzing is disabled.
7. Open a second tab on one phone: only one tab should be active. Refresh a phone, briefly disconnect/reconnect its Wi-Fi, and tap while disconnected. It must restore the same identity and never replay a tap.
8. Remove a throwaway player with confirmation. Their phone should lock and their old credential should remain invalid after refresh. Reopen joining if you want a new unique registration.
9. Accept a winner while another player is excluded; stop/restart the server. Confirm both identities, winner, and exclusion survive. Resume on the host, re-enable audio, and explicitly reopen buzzing. Also test restarting while buzzing is open: it must return closed.
10. End the session with confirmation. Every phone should disable. Start fresh, check the board resets and saved game remains intact, and verify old QR links/credentials cannot enter the new game.

## Developer notes and scope

React/TypeScript/Vite, Node/Express, SQLite via Node, and Socket.IO. All fonts/icons/assets are local; no CDN dependency. `server/access.ts` restricts local management. `server/live.ts` owns validated revisioned actions, per-connection roles, audio ownership, and field-by-field public projections. `shared/live.ts` defines wire shapes; `src/Live.tsx` provides the setup, display, and host interfaces. `server/players.ts` owns normalized names, hashed credentials, active tabs, and atomic buzzer acceptance; `src/Party.tsx` provides local QR generation, party controls, and phone pages. Public broadcasts omit host credentials and every unrevealed answer. The host credential is validated independently for HTTP private state and Socket.IO connections/actions.

Saved games, categories, clues, and media keep stable IDs and explicit order. Session snapshots live separately from game definitions; action IDs and revisions protect retries and concurrent tabs. Audio ownership/playback is memory-only. Player identities are stored separately in `session_players`. Player socket/API payloads are built independently and contain no answers (even revealed ones) or host credentials. Presence is memory-only. Successful buzzes persist the winner/window/eligibility in the session snapshot; no scoring records or response timers exist.

For development, run `npm run dev:server` and `npm run dev` in separate Terminals. Vite proxies `/api` and `/socket.io` (including WebSockets) to Express. Normal startup serves all frontend, API, media, and Socket.IO traffic from one origin.

Phase 3 includes no scoring, response timers, Daily Doubles, Double Jeopardy, Final Jeopardy, external accounts, or cloud deployment.
