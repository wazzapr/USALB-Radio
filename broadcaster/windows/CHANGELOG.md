# USALB Broadcaster Changelog

## 1.0.11
- Includes the latest broadcaster ingest connection and handshake fixes.
- Keeps the 12-second handshake timeout and initial silent frame for reverse-proxy compatibility.
- Keeps automatic reconnect and clearer connection diagnostics.
- Includes the Steam-style update flow with **What's New** and **CHECK FOR UPDATES**.
- Version, installer, and release metadata are synchronized to 1.0.11.

## 1.0.10
- Added a **What's New** button next to Check for Updates.
- What's New shows the installed version, latest release version, and release notes from GitHub.
- Bumped the broadcaster version so new builds are correctly detected as updates.
- Kept the existing automatic in-place updater and restart flow.

## 1.0.9
- Added clearer broadcaster ingest connection diagnostics.
- Added a 12-second handshake timeout.
- Sends an initial silent audio frame to complete the chunked ingest handshake through reverse proxies.
- Preserved connection errors in the main broadcaster status area.
- Kept automatic reconnect for live audio connections.
