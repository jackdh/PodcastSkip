# AGENTS.md

## Cursor Cloud specific instructions

Podflow is a single-service, frontend-only React 19 + Vite PWA (package name `podcastskip`). There is no backend, database, or Docker; all podcast/transcript data is mock data hardcoded in `src/App.tsx`. Settings (ad-skip toggle, OpenRouter model/key) persist to `localStorage` only — the OpenRouter integration is not wired to any network call yet.

Commands are defined in `package.json` and documented in `README.md`:
- Dev server: `npm run dev` (Vite on `http://localhost:5173`).
- Build: `npm run build` (`tsc -b` typecheck + `vite build`, emits PWA service worker via `vite-plugin-pwa`).
- Storybook (optional UI lab): `npm run storybook` (port 6006).

Non-obvious caveats:
- `npm run lint` currently fails: the `lint` script runs `eslint .` but the repo ships no `eslint.config.js` (ESLint 10 requires flat config). This is a pre-existing repo gap, unrelated to environment setup.
- `vite.config.ts` disables the PWA plugin when the `STORYBOOK` env var is truthy (Storybook sets it) to avoid service-worker conflicts. To test PWA/service-worker behavior, use `npm run build` + `npm run preview`, not the Storybook flow.
