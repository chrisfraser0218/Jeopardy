# Portable Jeopardy game format, version 1

The authoritative machine-readable schema is [game-format.schema.json](game-format.schema.json). Examples: [text-only JSON](examples/text-only.json) and [image/audio ZIP](examples/image-audio.zip). Both include repeat and one-attempt categories and are verified through the actual importer. The image is an original two-color graphic and the audio is a synthesized 440 Hz tone, dedicated to CC0; attribution is retained in the manifest and managed media records.

A file is either UTF-8 JSON with no attachments, or a ZIP with exactly this layout:

```
manifest.json
media/colors.png
media/tone.wav
```

No directories, symlinks, encryption, duplicate paths (including case variants), absolute paths, parent segments, extra files, URLs, HTML execution, or external downloads are supported. ZIP paths are portable relative paths, never internal database IDs. A media manifest alone is not a complete media package: the actual files must be in the ZIP.

The root object has exactly `format: "jeopardy-game"`, `version: 1`, `game`, and `media`. Unsupported versions are rejected without changing the library. Unknown fields are rejected, including live-session settings/state. Do not include IDs, revisions, player identities, host credentials, scores, wagers, responses, or buzzer activation. Manual/Automatic is chosen when starting a session.

`game` requires `title` (nonblank, ≤200 characters), `description` (≤2,000), and `categories`. Each board has exactly six categories. A category has `order` (unique 0–5), `name` (≤120), `attemptPolicy` (`repeat` or `one`), and exactly five clues. A clue has `order` (unique 0–4), `value` (integer $0–$1,000,000), `text` (≤10,000), `answer` (≤5,000), and `image`/`audio` (relative paths or null). Optional `dailyDouble` is boolean; use at most one on the first board and two on Double Jeopardy. Every policy must be explicit; new editor categories default to repeat, while legacy missing fields migrate to one attempt.

Optional `doubleJeopardy` is null or `{enabled, categories}` with the same six-by-five layout (usual values $400/$800/$1,200/$1,600/$2,000). Optional `finalJeopardy` is null or `{enabled, category, clue}`; its clue uses the same fields, conventionally order/value 0, and cannot be a Daily Double. Disabled optional-round drafts remain in exports and imports, including their attachments.

Drafts may have empty category names, clue text and answers. Imported drafts are valid library entries. Starting requires names, an answer, and text/image/audio for every enabled clue, plus a Final category if enabled. Only enabled rounds must be complete. Array order may vary: explicit `order` controls presentation.

`media` is an array of `{path, name, attribution?}` entries, exactly one per distinct referenced file. `path` must match `media/filename.ext`, with 1–120 ASCII letters/digits/dots/underscores/hyphens before an extension; it must start with a letter/digit and contain no `..`. `name` is a display name (1–255 characters); `attribution` is optional plain text up to 2,000 characters. Reuse a path to share an attachment. All referenced files must exist. Unreferenced files are rejected. JPEG (.jpg/.jpeg), PNG, WebP, MP3, and WAV are supported; actual contents must match extension and image/audio kind.

Limits: JSON/manifest 2 MiB; archive upload 64 MiB; total expanded package 256 MiB; 130 entries; 122 distinct media items; each image 10 MiB; each audio file 20 MiB. ZIP metadata and streamed expansion are bounded. JSON with attachments is rejected with guidance to use ZIP; export never silently strips media.

Import flow: select file → validated preview with title/rounds/categories/clue/media counts and warnings → confirm. A preview expires after ten minutes; cancel discards it. Confirmation always creates a new game and new internal category/clue/media IDs. Duplicate titles or repeated imports never overwrite. Files are validated before committing; failure removes newly staged files and leaves earlier games/uploads intact. Session state is untouched.

To create an offline media game, create or license the actual assets, put them under `media/`, list attribution, update clue paths and `media`, and ZIP `manifest.json` plus those files at the root. Do not ZIP an enclosing folder. Use the reusable [ChatGPT prompt](CHATGPT_GAME_PROMPT.md).
