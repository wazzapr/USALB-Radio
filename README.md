# USALB Radio

USALB Radio is a mobile-first internet radio station. A Windows computer
captures its own system audio, FFmpeg encodes it as MP3, and the USALB server
relays that same live audio to listeners.

```text
YouTube / VLC / FL Studio / local audio
  -> Windows system-audio capture
  -> USALB Broadcaster (FFmpeg)
  -> POST /api/radio-ingest
  -> GET /api/radio-stream
  -> phone listener presses Play
```

The server does not use Listen2MyRadio or another external radio provider.

## Server configuration

Copy `.env.example` into your environment and set:

- `DATABASE_URL`: the Replit PostgreSQL connection
- `BROADCASTER_PAIRING_CODE`: the code the Windows broadcaster enters
- `PUBLIC_RADIO_STREAM_URL`: normally `/api/radio-stream`

The station control room is intentionally open and does not use email,
passwords, sessions, or registration. The database schema is created with:

```bash
pnpm --filter @workspace/db run push
```

## Broadcaster handshake

Pairing is separate from audio:

1. The Windows broadcaster sends the pairing code to
   `POST /api/broadcaster/pair`.
2. The server returns a persistent `publishToken`, `publishEndpoint`, and
   listener endpoint even if no audio is currently playing.
3. The broadcaster sends status to `/api/broadcaster/heartbeat`,
   `/api/broadcaster/telemetry`, and `/api/broadcaster/intent`.
4. It keeps one authenticated, chunked `POST /api/radio-ingest` connection
   open and sends encoded audio bytes.
5. The server relays every received audio chunk to connected
   `/api/radio-stream` listeners.

The complete Windows helper is in `broadcaster/README.md`.

## API and deployment routing

The Express production entrypoint is `artifacts/api-server/src/index.ts`. It
creates the actual HTTP server, mounts the Express app at `/api`, exposes the
WebSocket upgrade path, and owns the persistent ingest and listener streams.
The API artifact declares `/api`, `/ws`, and `/api/ws` as routed paths so the
published frontend rewrite cannot serve `index.html` for API requests.

Important endpoints:

- `POST /api/broadcaster/pair`
- `GET /api/broadcaster/commands`
- `POST /api/broadcaster/heartbeat`
- `POST /api/broadcaster/telemetry`
- `POST /api/broadcaster/intent`
- `POST /api/radio-ingest`
- `GET /api/radio-stream`
- `GET /api/stream-status`
- `GET /api/now-playing`

The browser player is intentionally user initiated. It never captures a
listener microphone and never autoplays.

## Development

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm run typecheck
```

The API server and the web app run through their configured Replit workflows.