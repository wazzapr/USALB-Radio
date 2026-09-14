# USALB Broadcaster for Windows

This is the broadcaster side of the USALB Radio architecture:

```text
Windows system audio -> FFmpeg MP3 encoder -> POST /api/radio-ingest
                                             -> USALB public /api/radio-stream
                                             -> phone / desktop listeners
```

USALB is the streaming server. No Listen2MyRadio account or external radio
provider is required.

## One-time server setup

Set these Replit environment variables:

- `BROADCASTER_PAIRING_CODE`: the code entered by the broadcaster
- `PUBLIC_RADIO_STREAM_URL`: normally `/api/radio-stream`
The pairing code is only used to exchange credentials. Pairing does not test
audio and does not require the broadcaster to be streaming.

## Install on Windows

1. Install FFmpeg and make sure `ffmpeg.exe` is on PATH.
2. Run `ffmpeg -devices` and confirm the Windows audio capture device is
   available.
3. Use Windows audio loopback/system audio as the source. Do not choose a
   microphone. Depending on the FFmpeg build, this is usually the WASAPI
   `default` loopback device or a device exposed by VoiceMeeter / Stereo Mix.
4. Copy `usalb-broadcaster.ps1` to the Windows machine.

To list WASAPI devices:

```powershell
ffmpeg -hide_banner -list_devices true -f wasapi -i dummy
```

## Start

Open PowerShell in this folder and run:

```powershell
.\usalb-broadcaster.ps1 `
  -ServerUrl "https://usalb-radio-12--applauncher20.replit.app" `
  -PairingCode "YOUR_PAIRING_CODE" `
  -AudioDevice "default"
```

The script:

1. Calls `POST /api/broadcaster/pair`.
2. Saves the returned device ID and publish token locally.
3. Sends heartbeat and telemetry requests.
4. Opens one authenticated, persistent `POST /api/radio-ingest`.
5. Encodes Windows system audio as MP3, 44.1 kHz, stereo, 128 kbps.
6. Reconnects the ingest connection if FFmpeg exits.

The pairing response contains the real persistent publish endpoint,
`/api/radio-ingest`, and the public listener endpoint,
`/api/radio-stream`. The response is returned even when no audio is present.

## Verify from a phone

Open the station website and press Play. The player uses the public USALB
relay endpoint, not the broadcaster endpoint. The admin diagnostics should
show:

- authenticated broadcaster connection
- audio bytes received
- public stream available
- `audio/mpeg` mobile-compatible content

If the broadcaster is connected but no bytes are received, the issue is the
Windows audio capture device or FFmpeg input, not pairing.

## Security notes

- Keep the pairing code private.
- Keep the generated `credentials.json` file private. It contains the
  broadcaster publish token.
- The publish token grants audio publishing only; it is never sent to browser
  listeners.
- The listener endpoint is read-only and does not accept broadcaster tokens.