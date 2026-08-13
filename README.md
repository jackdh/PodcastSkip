# Podflow

An offline-first podcast player that transcribes downloaded episode audio,
detects ad segments in that speech, and skips them during playback.

Publisher or Apple transcript URLs are never used. Those files usually omit
ads, which would make skip-ads trivial to defeat.

## Highlights

- Installable PWA for iOS and Android, with a service worker for app-shell offline use.
- Downloaded episodes play from Cache Storage when offline; search and live timelines still need a network.
- Settings includes a Force update control plus the build version and update date (injected at deploy time).
- Settings → Copy logs stores recent Highlight ads / crash lines in localStorage so a phone refresh can still be diagnosed.
- Responsive desktop and mobile podcast listening interface.
- Live Apple Podcasts catalog search, show episodes, and browser audio playback.
- Same-origin Pages Function audio streaming and persistent Cache Storage downloads for offline listening.
- Interactive, follow-along transcript: the current line scrolls into view, the spoken word is highlighted, and tapping a word jumps playback.
- Local settings for automatic ad skipping, analysis window (first N minutes), playback speed, and an OpenRouter API key/model choice.
- OpenRouter connection test from Settings, plus local minutes-saved tracking.
- Highlight ads by transcribing downloaded audio with Whisper, then marking breaks on the progress bar and auto-skipping during playback.
- Storybook design lab with desktop and mobile app stories.

## PWA notes

Use `npm run build` and `npm run preview` to exercise the production service worker.
Force update in Settings checks for a new worker and reloads the app so installed clients are not stuck on an old build.
Offline listening requires downloading an episode while online first.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. To develop the visual system independently:

```bash
npm run storybook
```

## OpenRouter integration note

API-key storage stays client-local. Settings can verify the key against
OpenRouter (`GET /api/v1/key`). Highlighting ads on a download:

1. Sends the cached episode audio to OpenRouter speech-to-text (Whisper by
   default, or Qwen3 ASR Flash) in short chunks with timed transcript
   segments. The request body is WAV bytes from the download, not a remote
   transcript URL. Settings can limit this to the first N minutes (default 30)
   so a phone test does not transcribe a full episode. Now playing warns when
   playback is past the scanned region and offers a full-episode re-scan.
2. Asks your chosen analysis model (DeepSeek V4 Flash by default) to mark
   advertisement ranges from numbered transcript cues (not free-form clocks).
   transcript cues (not free-form clocks). Predicted ranges are snapped onto
   nearby commercial lines so a round guess like 20:00–21:30 becomes the real
   read (for example 19:05–20:32).
3. Stores cues in IndexedDB (Safari localStorage is too small for a full
   episode transcript) and ad ranges in localStorage. Open now playing to
   follow the transcript as it plays; tap a word to jump. If ads are marked
   but the words are missing, re-scan the episode. Downloads lists each marked
   range with a short excerpt.

Local `npm run dev` and `npm run preview` proxy publisher audio through
`/api/audio` (same rules as the Cloudflare Pages Function) so downloads and
Highlight ads work off production.

Production deployments should prefer a secure backend or user-owned key vault for
key handling. Long episodes take several transcription requests and will use
OpenRouter credits.

## One-off real ad-detect harness (manual)

Not wired into CI. Cloud agents (or you) can run a real podcast through the same
Whisper → analysis pipeline and inspect a JSON report of cues + ad segments.

```bash
# Requires ffmpeg on PATH and an OpenRouter key with credits
cp .env.example .env.local   # or export OPENROUTER_API_KEY=...
npm run test:ad-detect -- --query "NPR Up First" --max-minutes 3
```

Defaults analyse only the first few minutes to limit spend. Use
`--start-minutes` to jump to a mid-roll (for example `--start-minutes 18
--max-minutes 4`). Pass `--stt-model qwen/qwen3-asr-flash-2026-02-10` and
`--model deepseek/deepseek-v4-flash` to try Qwen ASR + DeepSeek for ads. Report lands at `tmp/ad-detect-report.json` (and
`/opt/cursor/artifacts/ad-detect-report.json` in Cursor cloud). Each predicted
ad includes a short transcript excerpt (`before` / `during` / `after`) so you
can judge false positives without dumping the whole file. Pass `--help` for
flags (`--audio-url`, `--model`, `--out`).

Clock-snap helper (no API key):

```bash
npm run test:ad-refine
```

## Tests

```bash
npm test
```

Runs Vitest unit tests for transcript follow, the segmented ad scrubber, and scan-coverage, plus the existing ad-refine and settings-store checks. Live OpenRouter detection stays `npm run test:ad-detect` and is not part of CI.
