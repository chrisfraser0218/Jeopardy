# Phase 1 verification

Completed November 10, 2026 on macOS arm64, using Node.js 24.11.0 and installed Google Chrome via Playwright.

## Completed checks

- `npm run build`: TypeScript checks and Vite production build passed.
- `npm test`: both integration tests passed. They verify game create/read/update/delete, six-category/five-clue defaults, draft saves, stable IDs, edited categories/values/content, ready counts, invalid definitions, revision conflicts, atomic rollback, and cascading game deletion.
- All five supported formats (JPEG, PNG, WebP, MP3, WAV) were uploaded and retrieved byte-for-byte. Size, unsupported-extension, content/extension mismatch, missing-media, and wrong-media-kind rejections passed. Audio range requests returned HTTP 206.
- Saved image/audio attachments stayed accessible during unsaved replacement/removal. Saved replacement/removal and retained original media were verified.
- A separate backend process was stopped and restarted against the same temporary SQLite database and uploads folder. The game, answer, clue ordering, audio attachment ID, and audio bytes survived unchanged. A deleted sample was not recreated.
- Cross-origin mutations were rejected, and an attempted media path traversal did not return a file.
- `npm run test:browser`: the Chrome workflow passed. It covered library creation/editing/deletion, category and value edits, JPEG/PNG/WebP decoding, WAV/MP3 loading and playback, pause/replay, no autoplay, answer hiding/reveal/hide, image/audio failure messages, invalid upload messages, failed-save recovery, and unsaved internal-navigation and browser-reload prompts.
- A fresh 390 × 844 browser page fit the viewport without page-wide horizontal overflow; the board remains horizontally scrollable inside its own area. Desktop was checked at 1440 × 1050. Screenshots of library, editor, preview, and mobile editor were captured and visually inspected.
- Browser requests stayed on the local origin. There are no CDN/font/cloud requests required by the app.
- The exact normal startup command, `./start.command`, started successfully and served the sample library at `http://localhost:3000/api/games`. Control-C shut it down. The server is stopped at handoff.
- `git diff --check` passed. The pre-existing user modification to `Start.txt` was preserved.

## Practical limits

- Browser checks were automated in headless Chrome. Safari, a physical iPad/phone, audible speaker quality, and every possible encoding inside MP3/WAV containers were not manually tested. Uploaded containers with damaged or unsupported encodings can fail playback; the UI offers a replacement message.
- An existing desktop Chrome page reported stale document width after resizing following native dialogs; a fresh phone-sized page passed the width assertion and rendered correctly. Fresh mobile-page coverage is retained in the test suite.
- The app does not automatically clean unused uploads. Retention is deliberate to protect saved attachments; disk usage can grow.
- Node 24.11 emits its SQLite experimental-feature notice. Vite reports third-party Zod comment-annotation warnings; the build succeeds and emitted assets work.
- No Phase 2 multiplayer, QR, host-controller, score, or buzzer features were implemented.

## Repeat checks

From the project folder, use the prepared local Node runtime if Node is not installed globally:

```sh
export PATH="$PWD/.runtime/node/bin:$PATH"
npm run build
npm test
npm run test:browser
```

Tests use temporary storage and remove it on completion; they do not modify `data/`. Browser screenshots are ignored under `artifacts/`.
