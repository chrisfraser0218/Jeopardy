# Blueboard — local Jeopardy-style game night

Phase 2 adds a large-screen board, a private iPad host controller, and synchronized live sessions. The Phase 1 library, draft editor, media uploads, and previews remain available on the MacBook. Games, media, and session progress stay on your Mac; after installation, play needs no internet or paid services.

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

## Audio and images

Clue images preserve their aspect ratio. Text, an image, and audio can be combined.

Sound plays **only on the designated MacBook display**. The host has Play/Pause/Replay buttons but no audio player. Click **Enable Audio** on the desired display through localhost to satisfy browser playback rules. A silent, muted clip unlocks the player; clue audio never starts automatically. The host shows audio readiness, playback state, and errors.

Only one connected display can own audio. To move sound to another MacBook display tab, choose **Release Audio** in the current tab or close it, then enable the other tab. A second tab cannot take ownership while the first is connected. Non-local display pages cannot claim audio. Refreshing/reconnecting the display releases audio ownership; click Enable Audio again. Other public display tabs remain silent.

Play/Pause/Replay are short-lived commands for the current clue and revision, not stored playback instructions. They are deduplicated, expire quickly, and are not replayed after a reconnect. Leaving a clue, ending a session, or losing the display connection stops its audio. On connection loss this occurs when the browser detects the loss. A server restart always resets audio to stopped. If playback fails, the host receives a message; re-enable audio on the MacBook or return to the board. Editing the saved game cannot replace a damaged file in a running snapshot; end and start a new session after editing if needed.

## Resume after a connection problem or server restart

- Refreshing a display or host reloads the current authoritative session, including the current clue, revealed answer state, and completed clues. The host credential in that tab survives refreshes.
- When disconnected, controls stop accepting actions and the screen shows its connection status. Keep the server running and reconnect to Wi-Fi; Socket.IO reconnects and requests the current snapshot. There is no offline queue of host actions.
- After stopping/restarting the server, progress is preserved and the session is **paused**. Open the current private host link from the MacBook library if needed, then tap **Resume session** on the host. The current clue and answer visibility are preserved. Re-enable audio on the display; it will not resume playing by itself.
- Saved-game edits and deletions do not alter an ongoing session: it uses its own copied game definition and retained media IDs.

## Wi-Fi and macOS troubleshooting

- If macOS asks whether Node may accept incoming connections, allow it for this local game. If another device cannot connect, find **Firewall** in macOS System Settings and check that Node is allowed to accept incoming connections. Do not forward ports on your router or expose this server to the internet.
- Check the iPad URL begins with the MacBook's current Wi-Fi address and includes the same port. IP addresses can change when switching/rejoining networks; recopy the current link from the library.
- Guest, hotel, school, and some mesh Wi-Fi networks enable **AP/client isolation**, blocking devices from reaching one another. Use a trusted network that permits device-to-device traffic. Being on the same Wi-Fi name alone does not guarantee connectivity.
- Disconnect a VPN temporarily if it blocks local-network traffic, and check that both devices are on the same usable local network. Keep the MacBook awake and its server Terminal open during play.
- If port 3000 is busy, stop the other app or use `PORT=3001 ./start.command`. Open `http://localhost:3001` and recopy the generated links.
- The library, editor, uploads, and session-management endpoints are deliberately denied over the LAN, even from the MacBook's own Wi-Fi URL. Use localhost on the MacBook for these. An iPad should use its private `/host#…` link, or a public `/display` link.
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
| `data/games.sqlite` | Saved definitions, separate answer records, media metadata, and the separate live-session snapshot/progress |
| `data/games.sqlite-wal`, `data/games.sqlite-shm` | SQLite working files while running |
| `data/uploads/` | Local media files |
| `dist/` | Built frontend, regenerated by `npm run build` |

**Stop the server before backing up**, then copy the whole `data` folder. Restore it with the server stopped. Keep database and uploads together. Backups include the active session's private host credential. SQLite migration v2 adds a separate session table without replacing saved definitions or uploads. Do not downgrade to the Phase 1 server against a v2 database.

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

Run this short checklist with your MacBook and iPad:

1. Start the server, allow firewall access if prompted, start the sample game, and open the MacBook display fullscreen. Enable Audio there.
2. Open the private Wi-Fi host link on the iPad. Rotate between portrait and landscape and check the controls are comfortable to tap.
3. Select a clue containing an image and audio. Check image proportions, actual speaker sound, Play/Pause/Replay, and silence on the iPad. A second display tab should fail to claim sound while the first owns it.
4. Reveal the answer, then complete the clue. Reopen it explicitly and confirm the answer starts hidden. Return without completing and check the clue stays available.
5. Refresh each device and briefly disconnect/reconnect the iPad's Wi-Fi. Verify the current board returns and disconnected controls stay disabled.
6. Stop and restart the MacBook server. Resume from the host; confirm progress survived and audio stays stopped until re-enabled and played.
7. End the session with confirmation. Start fresh and check the board resets while the saved game remains intact.

## Developer notes and scope

React/TypeScript/Vite, Node/Express, SQLite via Node, and Socket.IO. All fonts/icons/assets are local; no CDN dependency. `server/access.ts` restricts local management. `server/live.ts` owns validated revisioned actions, per-connection roles, audio ownership, and field-by-field public projections. `shared/live.ts` defines wire shapes; `src/Live.tsx` provides the setup, display, and host interfaces. Public broadcasts omit host credentials and every unrevealed answer. The host credential is validated independently for HTTP private state and Socket.IO connections/actions.

Saved games, categories, clues, and media keep stable IDs and explicit order. Session snapshots live separately from game definitions; action IDs and revisions protect retries and concurrent tabs. Audio ownership/playback is memory-only. Future players/scores/buzzer events have no table or UI in this phase.

For development, run `npm run dev:server` and `npm run dev` in separate Terminals. Vite proxies `/api` and `/socket.io` (including WebSockets) to Express. Normal startup serves all frontend, API, media, and Socket.IO traffic from one origin.

Phase 2 includes no player joining, QR codes, buzzers, scoring, timers, Daily Doubles, Double Jeopardy, Final Jeopardy, accounts, or cloud deployment.
