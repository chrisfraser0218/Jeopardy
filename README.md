# Blueboard — local game studio

Phase 1 of a Jeopardy-style party game: a game library, a 6 × 5 editor, local media, and player-style clue previews. Everything stays on your Mac. Internet access is needed only for the initial installation. There are no accounts, subscriptions, cloud services, external databases, or Docker requirements.

## Start on this Mac

This prepared workspace includes installed dependencies, a built frontend, and an ignored local Node.js runtime. Open Terminal and run:

```sh
cd /Users/chrisfraser/Jeopardy
./start.command
```

Open **http://localhost:3000** in Chrome or Safari. Leave the Terminal window running. To shut down, click that Terminal window and press **Control-C**. Start again with the same command; saved games will still be there. You can also double-click `start.command` in Finder.

## Install from a fresh checkout

1. Install **Node.js 24.11 or newer** (tested with 24.11.0) using the macOS installer at [nodejs.org](https://nodejs.org). Reopen Terminal after installation.
2. Change into the project folder and install/build:

   ```sh
   cd /Users/chrisfraser/Jeopardy
   npm ci
   npm run build
   ```

3. Normal startup is one command:

   ```sh
   ./start.command
   ```

`npm start` is equivalent if Node.js is on your PATH. `start.command` also recognizes `.runtime/node/bin/node`, a checkout-local runtime prepared during implementation; this directory is ignored by Git and is not needed when Node is installed normally. To use the local runtime for maintenance commands in this workspace:

```sh
export PATH="$PWD/.runtime/node/bin:$PATH"
```

After pulling source changes, run `npm ci` if dependencies changed, then `npm run build`. Startup serves the built frontend and API from the **same origin**, port 3000. It never runs an online installation or build automatically. A Node SQLite experimental-feature notice on Node 24.11 is expected.

## Make a game

- Choose **Create a game**, enter a title and optional description, and create it. New games have six categories and five clues per category, valued at $200–$1,000.
- Edit category names directly on the board. Select a clue tile to edit its value, text, answer, image, and audio. An image and audio can be attached together.
- A clue is ready when it has an answer and at least one of text, image, or audio. Dots and the ready count show progress. All incomplete games can still be saved as drafts.
- Choose **Save game** to persist edits. The header shows unsaved, saving, saved, or failed states. Failed saves preserve your draft so you can correct it and retry. New-game creation saves its empty board immediately; later edits require Save.
- **Preview clue** shows presentation content without its answer. Choose **Reveal Answer** when you want to see it. Audio never autoplays; the native controls provide play/pause/seek, and Replay starts it again from the beginning.
- Replace or remove media in the editor, then save. Leaving an unsaved edit prompts you before discarding it. Deleting a game requires confirmation.
- The clearly labeled sample game includes 30 original example clues and can be freely edited or deleted. It is created only when initializing a brand-new database.

## Local storage and backups

Paths are relative to the project folder in normal startup:

| Location | Contents |
| --- | --- |
| `data/games.sqlite` | SQLite game definitions, answers, and media metadata |
| `data/games.sqlite-wal`, `data/games.sqlite-shm` | SQLite working files while the app runs |
| `data/uploads/` | Uploaded images and audio, with generated UUID filenames |
| `dist/` | Built frontend; safe to regenerate with `npm run build` |

To back up, **stop the server first**, then copy the entire `data` folder to a safe location. Restore by stopping the server and replacing `data` with that backup. Keep the database and uploads together. Deleting `data` permanently resets the library and regenerates the sample on next startup.

Uploaded files are intentionally retained, even when replaced, removed, abandoned in an unsaved edit, or associated with a deleted game. This prevents losing attachments still referenced by saved games. There is no automatic media cleanup in Phase 1, so disk usage can grow. Do not manually remove individual uploads needed by a saved game. Original filenames are metadata only; the API resolves stable media IDs to generated storage names.

For development or isolated testing, `DATA_DIR` changes the storage directory and `PORT` changes the port:

```sh
DATA_DIR=/absolute/path/to/other-data PORT=3001 npm start
```

The normal launcher always changes to this project folder. The server binds to `127.0.0.1` by default. Phase 1 is intended for editing on this Mac. LAN devices, iPad host controls, QR joining, buzzers, scoring, special rounds, and live-session synchronization are outside this phase. The API has no authentication; keep the default loopback binding for normal use.

## Upload rules

| File | Allowed extensions | Maximum size |
| --- | --- | --- |
| JPEG | `.jpg`, `.jpeg` | 10 MiB |
| PNG | `.png` | 10 MiB |
| WebP | `.webp` | 10 MiB |
| MP3 | `.mp3` | 20 MiB |
| WAV | `.wav` | 20 MiB |

The UI rounds the unit label to MB; limits are 10 × 1,024² and 20 × 1,024² bytes. The server checks file signatures, matching extensions, media kinds, and size, accepts one file per request, and never uses an uploaded filename as a filesystem path. Formats are identified by content, not the browser-supplied MIME type. Upload rejection messages and image/audio loading failures are shown in the editor or preview. A valid container with an unsupported or damaged encoding can still fail playback; replace it with a working file.

## Verification

With Node on your PATH (or after the local-runtime PATH command above):

```sh
npm run build
npm test
npm run test:browser
```

`npm run build` checks TypeScript and builds Vite assets. `npm test` uses temporary directories and loopback servers to verify library CRUD, draft saves, defaults, stable IDs, clue edits, all five media formats, size/content rejection, attachment replacement/removal, stale-edit protection, transaction rollback, byte-range media serving, deletion, and **a real backend process restart with persisted game and audio data**. Tests do not alter your normal library.

The browser check uses installed Google Chrome at its standard macOS path. On another system, set `CHROME_PATH` to a Chromium/Chrome executable. It runs headless, uses temporary data, and writes ignored screenshots under `artifacts/`. It checks creation/editing/deletion, image decoding, audio loading and controls, hidden/revealed answers, unsaved-change prompts, rejected uploads, save errors, and mobile layout. The test browser has a separate profile and does not use your Chrome profile.

For a quick manual check:

1. Create a draft, edit a category and clue, attach an image and audio, then save.
2. Preview, play/pause/replay the audio, and reveal the answer.
3. Replace/remove attachments without saving, leave the editor, and confirm the saved originals return when you reopen it.
4. Save replacements/removals. Stop with Control-C, restart, and check the same game.
5. Try an unsupported or oversized file, and delete a throwaway game after confirming.

See [VERIFICATION.md](VERIFICATION.md) for checks completed during implementation and their limits.

## Developer notes

- React + TypeScript + Vite frontend; Node + Express backend; Node's built-in SQLite driver. All dependencies are free/open source. Fonts use the local system font stack; icons are local text/CSS. No CDN requests.
- `shared/model.ts` defines editor data and validation. `server/db.ts` owns transactions and ordered records. `server/app.ts` owns HTTP and upload handling. `src/main.tsx` and `src/style.css` provide the UI.
- SQLite `PRAGMA user_version` drives a transactional v1 schema migration. Games, categories, clues, and media have stable UUIDs; positions are explicit. Answers live in their own table. Saves atomically replace a game's ordered definition and increment its revision; stale tabs get a conflict instead of overwriting newer work.
- These are game definitions, not live sessions. There are no scores, player records, or buzzer events. A future Socket.IO layer can use the store without tying synchronization to the editor. Editor APIs currently include answers; a future player-facing API must select presentation fields and omit the separate answer table.
- For frontend development, run `npm run dev:server` in one Terminal and `npm run dev` in another. Open Vite's printed URL; its `/api` proxy keeps browser requests on one origin. Normal startup uses only Express and the built assets.
- If port 3000 is busy, stop the other app or use `PORT=3001 ./start.command` and open the matching URL. If a save reports an edit conflict, copy any changes you want to keep, return to the library, and reopen the latest version. If the browser cannot connect, confirm the server Terminal is still running.
