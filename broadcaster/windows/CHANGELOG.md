# USALB Broadcaster Changelog

## 1.0.19
- Pre-connects a replacement WebSocket before the recurring five-minute upstream connection termination, preserving automatic live recovery without waiting for the forced disconnect.


## 1.0.18
- Adds a 1.5 second forward audio cushion before initial playback and after automatic WebSocket reconnects.
- Uses the existing captured audio buffer to absorb short reconnects without replaying or duplicating audio.

## 1.0.17
- Added a Live Diagnostics window with connection health, audio-flow health, reconnect count, uptime, frames and bytes sent.
- Captures WebSocket close codes, close reasons, server error messages, receive errors, reconnect failures, and broadcast-loop errors.
- Added Copy Diagnostics and Send to GitHub report actions for troubleshooting.


## 1.0.16
- Added persistent WebSocket connection monitoring with server close-code and close-reason diagnostics.
- Added automatic reconnect retry handling for genuine connection failures.
- Keeps 44.1 kHz stereo PCM streaming and automatic broadcaster enrollment.
- Improved connection stability diagnostics for long-running live broadcasts.

## 1.0.15
- Fixed automatic update versioning so new Broadcaster builds are detected by the in-app Update button.
- Includes the current authenticated persistent WebSocket broadcaster connection.
- Keeps automatic enrollment, reconnect, 44.1 kHz stereo capture, and the automatic updater.

## 1.0.14
- Replaced manual pairing-code entry with automatic device enrollment.
- The Broadcaster now obtains and saves its private publish credential automatically from the USALB server.
- GO LIVE no longer requires manually finding or entering a broadcaster key.
- Keeps the existing 44.1 kHz stereo live ingest, reconnect, update flow, and connection diagnostics.

