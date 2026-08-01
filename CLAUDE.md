# Easy-scan

A client-side PWA document scanner: camera → detect document edges → perspective-correct ("flatten") → enhance → multi-page PDF. **No backend, no accounts, no database.** A personal tool, shareable by URL.

## Stack
- Vite + React + TypeScript
- **Mantine UI** (`@mantine/core` + `@mantine/hooks`) — all components & theming; `MantineProvider` wraps the app (dark scheme, theme in `src/ui/theme.ts`)
- `vite-plugin-pwa` (manifest + service worker — installable, offline)
- OpenCV.js running inside a Web Worker (ADR-0002) — added at M2
- `pdf-lib` for PDF export — added at M7
- Storage: **OPFS only, no database** (ADR-0003)

> **Node:** requires Node `^20.19 || >=22.12` (developed on Node 24). Current tooling: Vite 8, `@vitejs/plugin-react` 6, TypeScript 7.

## Code style — pragmatic functional programming
- Functional components and hooks. **No classes.**
- **Immutable data:** `readonly` fields and `readonly` arrays/tuples; produce new objects on change, never mutate in place.
- **Pure functions for logic**; isolate side effects (camera, OPFS, worker, DOM `<canvas>`/pointer) behind modules with a small impure surface.
- Prefer **discriminated unions** for state and messages (e.g. `Screen`, `CvRequest`).

## Architecture — three layers, kept separate
1. **UI shell (React)** — components, hooks, navigation. Owns view state only; talks to services via hooks/ports.
2. **Imperative services (outside React's render cycle)** — camera controller, canvas/corner-drag, worker client, storage port. Expose functions/events; React subscribes via `useSyncExternalStore`. Keeps 60fps canvas/pointer work off React's reconciliation.
3. **Web Worker (OpenCV.js)** — detection, perspective correction, enhancement. Takes `ImageData` in, returns `Quad` / corrected bytes. Never runs on the main thread.

Library reactivity comes from a `useSyncExternalStore` store over the storage port — no framework DB, no `useLiveQuery`.

## Project knowledge
- `CONTEXT.md` — domain glossary (ubiquitous language: Document, Page). Read it for terms; keep it free of implementation. Add terms as they crystallise.
- `docs/adr/` — architectural decisions and *why*. Read before changing fundamentals; add an ADR only when a decision is hard to reverse, surprising without context, and the result of a real trade-off.

## Commands
- `npm run dev` — dev server (localhost is a secure context, so the camera works in dev)
- `npm run build` — typecheck (`tsc -b`) + production build
- `npm run preview` — preview the production build
- `npm run typecheck` — typecheck only

## Agent skills

### Issue tracker

Issues and PRDs live as markdown files under `.scratch/<feature>/` (local tracker). See `docs/agents/issue-tracker.md`.

### Triage labels

Five default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
