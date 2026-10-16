# Cloudflare Pages deployment

This repository is a static React/Vite single-page application. Configure the
Cloudflare Pages project with:

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: pinned by `.node-version` (`22.16.0`)

Set these build environment variables in the Cloudflare Pages project before
the first production build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These are browser-visible Supabase client configuration values, not server
secrets. Never put a Supabase service-role key, Gemini/NVIDIA private key, or
`.env` file in this frontend repository or in a `VITE_*` variable. Keep
database access protected by Supabase Row Level Security (RLS).

Cloudflare Pages serves this Vite SPA with its default SPA fallback as long as
the published output does not contain a top-level `404.html`. No Vercel
rewrite configuration is required. Use a Pages preview deployment to verify
login, sync, direct-route refresh, and PWA installation before assigning a
production custom domain.

Hosting the frontend does not move application data or APIs to Cloudflare.
Dexie/IndexedDB data remains in each user's browser on that device; Supabase
and external AI APIs continue to run separately.
