# USALB Broadcaster

Native Windows broadcaster for USALB Radio.

## Current architecture

Windows system audio / microphone
        ↓
USALB Broadcaster (WASAPI + PCM mixer)
        ↓ one persistent authenticated WebSocket
USALB server
        ↓
Liquidsoap
        ↓ continuous MP3 stream
USALB listeners

The broadcaster sends 44.1 kHz, stereo, 16-bit PCM in PCM1 frames. The server feeds that PCM directly into Liquidsoap. Liquidsoap is the single public stream engine and encodes the listener stream to MP3.

## Connect

1. Open the USALB Control Room.
2. Pair the Windows broadcaster using the server pairing code.
3. Copy the private broadcaster/stream password returned by pairing.
4. Open USALB Broadcaster on Windows.
5. Enter the USALB server URL and paste the private broadcaster key.
6. Select system audio and/or microphone.
7. Press GO LIVE.
8. The broadcaster waits for the server's live confirmation before showing LIVE.

## Audio

- Windows WASAPI loopback for system audio
- Optional microphone input
- 44.1 kHz stereo PCM
- Music, microphone and master gain
- 3-band EQ
- Peak limiter
- Real-time frame pacing
- Buffered capture headroom to avoid dropping captured audio

## Build

The GitHub Actions workflow at .github/workflows/build-broadcaster.yml creates:

- Windows installer
- Portable Windows ZIP
- GitHub release assets under broadcaster-latest

The current broadcaster is a native Windows app. It does not depend on a browser tab to capture or publish audio.
