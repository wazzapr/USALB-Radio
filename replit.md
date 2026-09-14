# USALB Radio

USALB Radio relays authenticated Windows system-audio broadcasts to mobile listeners with real stream health, now playing metadata, chat, and an admin control room.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/usalb-radio run dev` — run the public web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `SESSION_SECRET`, and `BROADCASTER_PAIRING_CODE`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + native WebSocket server
- DB: PostgreSQL + Drizzle ORM
- Validation: OpenAPI-generated Zod schemas
- Frontend: React + Vite + TanStack Query
- API codegen: Orval
- Build: esbuild for the API and Vite for the web app

## Where things live

- `artifacts/usalb-radio` — public listener web app and admin console
- `artifacts/api-server` — Express API, WebSocket entrypoint, broadcaster ingest, and listener relay
- `lib/api-spec/openapi.yaml` — source of truth for the typed API contract
- `lib/db/src/schema` — Drizzle database schema
- `broadcaster` — Windows pairing and FFmpeg system-audio broadcaster helper

## Architecture decisions

- Pairing is independent of streaming: a valid code creates persistent broadcaster credentials without probing for audio.
- The server owns the live relay: the broadcaster uploads one authenticated chunked MP3 connection, and listeners read `/api/radio-stream`.
- `LIVE` requires recent broadcaster audio bytes, not just a healthy website or heartbeat request.
- API and WebSocket routes are declared in the API artifact routing so the web app's SPA rewrite cannot swallow them.

## Product

- Mobile-first real live player with pause, volume, reconnect, and honest OFFLINE/CONNECTING/LIVE states
- Now playing metadata, listener presence, live chat, and station information
- Authenticated station control room with diagnostics, metadata, moderation, and settings
- Windows broadcaster pairing and FFmpeg system-audio relay

## User preferences

- Keep USALB as the streaming server; do not replace it with Listen2MyRadio or another external provider.
- The public player must represent actual audio availability and never fake LIVE.

## Gotchas

- The API artifact must keep `/api`, `/ws`, and `/api/ws` in its routed paths.
- A pairing response must not depend on active audio. Audio is tested only after `/api/radio-ingest` starts receiving bytes.
- The public audio URL is `/api/radio-stream`; do not expose the broadcaster publish token to listeners or frontend code.

## Pointers

- See `README.md` and `broadcaster/README.md` for deployment and Windows setup.
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.