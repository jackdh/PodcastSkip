# Podflow

An offline-first podcast player concept that detects ad segments in downloaded
episode transcripts and skips them during playback.

## Highlights

- Installable PWA for iOS and Android, with a service worker for app-shell offline use.
- Responsive desktop and mobile podcast listening interface.
- Live Apple Podcasts catalog search, show episodes, and browser audio playback.
- Same-origin Pages Function audio streaming and persistent Cache Storage downloads for offline listening.
- Interactive transcript with clearly marked AI-detected advertisement ranges.
- Local settings for automatic ad skipping and an OpenRouter API key/model choice.
- Storybook design lab with desktop and mobile app stories.

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

This prototype deliberately keeps API-key storage and transcript analysis
client-local. Production use should route OpenRouter requests through a secure
backend or a user-owned key vault. The ad-marked transcript remains a
demonstration until real transcript extraction and analysis are implemented.
