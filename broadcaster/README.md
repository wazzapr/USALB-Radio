# USALB Broadcaster connection model

USALB Broadcaster uses the same simple station-connection model as a traditional SHOUTcast/ICEcast source client, but connects directly to the USALB server.

## Station connection

The broadcaster needs these values:

- **Station name** — display name, normally `USALB Radio`.
- **Hostname** — the public USALB server hostname, for example `usalbtv.com`.
- **Address** — the same server address/hostname used for the connection; this is kept as a separate field for a BUTT-style UI.
- **Port** — normally `443` when the station is served over HTTPS.
- **Stream password** — the broadcaster's private publish token returned by pairing. This is not the public Control Room password.
- **Protocol** — USALB authenticated stream.
- **Codec** — MP3.
- **Bitrate** — 128 kbps by default.
- **Sample rate** — 44.1 kHz by default.
- **Channels** — stereo by default.

## Connection sequence

1. The broadcaster pairs once using the station pairing code.
2. The server returns a unique `publishToken` for that broadcaster device.
3. The broadcaster stores that token securely as its stream password.
4. When the user presses **Connect**, the broadcaster authenticates with that token.
5. When the user presses **Go Live**, it opens one persistent connection to the server's `publishEndpoint` and continuously sends encoded MP3 audio.
6. The server publishes that audio through its public `publicStreamEndpoint`.
7. When the user presses **Stop**, the persistent ingest connection is closed and the station becomes offline.

The current API returns the following connection values from `/api/broadcaster/pair`:

- `publishEndpoint` — authenticated source/ingest endpoint
- `publicStreamEndpoint` — listener stream endpoint
- `heartbeatEndpoint` — connection telemetry
- `telemetryEndpoint` — stream telemetry
- `intentEndpoint` — broadcaster intents
- `commandsEndpoint` — remote commands

This is intentionally a USALB-native source protocol. Listen2MyRadio and an external SHOUTcast provider are not required.
