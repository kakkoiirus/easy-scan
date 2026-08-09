# Deploy to GitHub Pages as a project subpath

Easy-scan is published as a static site on **GitHub Pages**, built and deployed by a GitHub Actions workflow (`deploy.yml`) on every push to `main`. Because the repo is a project page, Pages serves it at a subpath — `kakkoiirus.github.io/easy-scan/` — not the origin root. The Vite production build therefore sets `base: '/easy-scan/'` (conditionally, so `vite dev` keeps serving at `/`), and the PWA manifest's `start_url`, `scope`, and `icon` are written as **relative** values (`'.'`, `'icon.svg'`) so they resolve against the manifest's own URL correctly under both bases. The ~16 MB OpenCV worker stays precached (ADR-0001) — the scanner remains fully offline on Pages.

**Why:** Pages is free, needs no account or backend, and a `<user>.github.io/<repo>` URL is genuinely shareable — a clean fit for "a personal tool, shareable by URL." The subpath is forced by the repo name; the conditional base and relative manifest are the smallest change that keeps the production build subpath-correct without disturbing the local dev loop. Deploying via the Actions artifact path (not a `gh-pages` branch) bypasses Jekyll, so no `.nojekyll`.

**Trade-offs accepted:**
- **Shared origin.** `kakkoiirus.github.io` is a single origin, so OPFS (ADR-0003), service-worker scope, and IndexedDB are shared across *every* project deployed under that account. For one tool this is harmless; a custom domain would isolate them, but that contradicts the no-accounts ethos and is rejected for now.
- **CDN caching of the service worker.** Pages serves `sw.js` with a ~10-minute `Cache-Control`, so a freshly pushed update can take up to ~10 min to reach users (`registerType: 'autoUpdate'` still self-corrects once the CDN flushes). Inherent to Pages, not changeable here.
- **Heavy first load.** First-time visitors download the ~16 MB precached worker before the scanner is ready, against Pages' soft 100 GB/month bandwidth budget. Acceptable for a personal tool; offline *after first use* is the requirement that matters (ADR-0001).

**Rejected alternatives:** a `gh-pages` branch push (more moving parts, leaves build output in history, needs `.nojekyll`); a separate platform such as Netlify/Vercel (would give a dedicated origin, but adds an account and contradicts "no backend, no accounts").
