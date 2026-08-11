# Podflow

An offline-first podcast player concept that detects ad segments in downloaded
episode transcripts and skips them during playback.

## Highlights

- Installable PWA for iOS and Android, with a service worker for app-shell offline use.
- Downloaded episodes play from Cache Storage when offline; search and live timelines still need a network.
- Settings includes a Force update control plus the build version and update date (injected at deploy time).
- Responsive desktop and mobile podcast listening interface.
- Live Apple Podcasts catalog search, show episodes, and browser audio playback.
- Same-origin Pages Function audio streaming and persistent Cache Storage downloads for offline listening.
- Interactive transcript with clearly marked AI-detected advertisement ranges.
- Local settings for automatic ad skipping and an OpenRouter API key/model choice.
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

1. Sends the cached episode audio to OpenRouter speech-to-text (`openai/whisper-1`)
   in short chunks with timed transcript segments.
2. Asks your chosen analysis model to mark advertisement ranges from that transcript.

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

Defaults analyse only the first few minutes to limit spend. Report lands at
`tmp/ad-detect-report.json` (and `/opt/cursor/artifacts/ad-detect-report.json`
in Cursor cloud). Pass `--help` for flags (`--audio-url`, `--model`, `--out`).
