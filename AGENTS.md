# AGENTS.md

## Cursor Cloud specific instructions

Podflow is a React 19 + Vite PWA (package name `podcastskip`) deployed through Cloudflare Pages. `functions/api/audio.js` is a Pages Function that streams a selected publisher audio URL through the same origin. It accepts only public HTTPS URLs and audio/octet-stream responses, then supports range requests for playback and Cache Storage downloads. Vite `npm run dev` / `preview` uses the same `/api/audio` proxy (`audioProxyPlugin.ts`) so local downloads are not blocked by CORS. The app queries the public Apple Podcasts Search API directly for catalog metadata only — never publisher/Apple transcript URLs (those omit ads). OpenRouter is wired for real ad detection: Settings stores the key/STT model/analysis model/analysis-window in `localStorage`, Downloads or Now Playing → Highlight ads decodes the downloaded audio, sends WAV chunks to Whisper (default, timed) or Qwen3 ASR Flash (15s buckets), then DeepSeek V4 Flash (default) or another analysis chat model on those spoken cues, and the player skips marked ranges when the toggle is on. Red marks on the progress bar show ad breaks. Now playing is a full-screen mobile sheet with a follow-along transcript (tap a word to seek).

Commands are defined in `package.json` and documented in `README.md`:
- Dev server: `npm run dev` (Vite on `http://localhost:5173`).
- Build: `npm run build` (`tsc -b` typecheck + `vite build`, emits PWA service worker via `vite-plugin-pwa`).
- Storybook (optional UI lab): `npm run storybook` (port 6006).
- One-off real ad detect (manual, burns credits; needs `OPENROUTER_API_KEY` + ffmpeg): `npm run test:ad-detect -- --query "…" --max-minutes 3`. Writes `tmp/ad-detect-report.json` for agent inspection. Do not put this on CI. Clock-snap check (no key): `npm run test:ad-refine`.

Git / deploy workflow:
- Always commit and push directly to `main`. Do not use feature branches or pull requests unless the user explicitly asks for one.
- Follow-up fixes belong on `main` too — never leave work only on a side branch after a merge.
- Cloudflare Pages production (`https://podcastskip.pages.dev`) deploys from `main`; branch/PR previews are separate URLs and are not what we use for day-to-day review.

Non-obvious caveats:
- `npm run lint` currently fails: the `lint` script runs `eslint .` but the repo ships no `eslint.config.js` (ESLint 10 requires flat config). This is a pre-existing repo gap, unrelated to environment setup.
- `vite.config.ts` disables the PWA plugin when the `STORYBOOK` env var is truthy (Storybook sets it) to avoid service-worker conflicts. To test PWA/service-worker behavior, use `npm run build` + `npm run preview`, not the Storybook flow.
