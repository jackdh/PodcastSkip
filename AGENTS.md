# AGENTS.md

## Cursor Cloud specific instructions

Podflow is a React 19 + Vite PWA (package name `podcastskip`) deployed through Cloudflare Pages. `functions/api/audio.js` is a Pages Function that streams a selected publisher audio URL through the same origin. It accepts only public HTTPS URLs and audio/octet-stream responses, then supports range requests for playback and Cache Storage downloads. The app queries the public Apple Podcasts Search API directly for catalog metadata; the transcript and ad-detection content remains a demonstration. Settings (ad-skip toggle, OpenRouter model/key) persist to `localStorage` only — the OpenRouter integration is not wired to any network call yet.

Commands are defined in `package.json` and documented in `README.md`:
- Dev server: `npm run dev` (Vite on `http://localhost:5173`).
- Build: `npm run build` (`tsc -b` typecheck + `vite build`, emits PWA service worker via `vite-plugin-pwa`).
- Storybook (optional UI lab): `npm run storybook` (port 6006).

Git / deploy workflow:
- For now, commit and push directly to `main`. Do not create feature branches or PRs unless asked.
- Cloudflare Pages production (`https://podcastskip.pages.dev`) deploys from `main`; branch/PR previews are separate URLs and are not what we use for day-to-day review.

Non-obvious caveats:
- `npm run lint` currently fails: the `lint` script runs `eslint .` but the repo ships no `eslint.config.js` (ESLint 10 requires flat config). This is a pre-existing repo gap, unrelated to environment setup.
- `vite.config.ts` disables the PWA plugin when the `STORYBOOK` env var is truthy (Storybook sets it) to avoid service-worker conflicts. To test PWA/service-worker behavior, use `npm run build` + `npm run preview`, not the Storybook flow.
