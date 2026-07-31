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
- Highlight ads on downloaded episodes; red markers on the progress bar and auto-skip during playback.
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
OpenRouter (`GET /api/v1/key`). Ad highlighting currently estimates break
timestamps from episode metadata via chat completions; real transcript or
audio analysis can replace that later. Production deployments should prefer a
secure backend or user-owned key vault for key handling.
