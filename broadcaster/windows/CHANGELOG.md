## 1.0.26

- Restores the v1.0.23/1.0.24 broadcaster connection and handoff baseline for controlled listener-gap testing.
- Restores the previous live relay server baseline so broadcaster and server changes can be tested separately.
- Keeps the 44.1 kHz stereo path, diagnostics, logo, updater, and automatic reconnect behavior.

## 1.0.25

- Removes the handoff acknowledgement wait from the 20 ms live PCM send loop.
- Keeps both old and replacement WebSockets receiving live PCM during the server-side handoff without pausing audio for the control-message round trip.
- Prevents the approximately 1–2 second audible gap caused by waiting for the handoff acknowledgement inside the audio loop.
- Release build trigger synchronized after the version bump.

## 1.0.24

- Lets the server own the old WebSocket close after an acknowledged handoff.
- Prevents the Broadcaster from locally aborting the previous socket at the exact rotation boundary.
- Keeps the replacement sending live PCM while the previous transport remains open through the handoff.

﻿## 1.0.23

- Keeps the old WebSocket open until the server confirms the replacement PCM frame is the live source.
- Prevents the Broadcaster from aborting the old connection before the server-side handoff is committed.
- Keeps the existing continuous PCM overlap, automatic rotation, diagnostics, logo, updater, and 44.1 kHz stereo path.

# USALB Broadcaster Changelog

## 1.0.22

- Mirrors each live PCM frame to the old and replacement WebSocket during planned rotation so the handoff stays continuous.
- Completes the Broadcaster-side handoff only after the replacement accepts the same live PCM frame.
- Keeps the existing 44.1 kHz stereo audio path, automatic reconnect, diagnostics, logo, updater, and all previous Broadcaster fixes.


## 1.0.21

- Fix seamless WebSocket rotation so the old connection is aborted locally after the replacement's first PCM frame, preventing the 20 ms audio loop from stalling during handoff.
- Keeps the in-app updater compatible by publishing the new version through the existing `broadcaster-latest` GitHub release.

## 1.0.20
- Uses the exact main USALB station logo inside the Broadcaster and as the Windows application/installer icon.
- Makes the 4:30 WebSocket rotation overlap the old connection and hand off on the first PCM frame without waiting for the 1.5-second forward audio cushion.

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

