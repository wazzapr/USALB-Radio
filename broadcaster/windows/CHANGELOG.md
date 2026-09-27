## 1.0.14
- Replaced manual pairing-code entry with automatic device enrollment.
- The Broadcaster now obtains and saves its private publish credential automatically from the USALB server.
- GO LIVE no longer requires manually finding or entering a broadcaster key.
- Keeps the existing 44.1 kHz stereo live ingest, reconnect, update flow, and connection diagnostics.

# USALB Broadcaster Changelog

## 1.0.13
- Fixed broadcaster update-version parsing when the GitHub release tag is `broadcaster-latest`.
- The updater now extracts the semantic version from either the release tag or release name, including legacy malformed release names.
- Keeps the 1.0.12 pairing, handshake, reconnect, and update features.

## 1.0.12
- Added automatic device pairing so the private publish key is created by the server and saved locally instead of being manually entered.
- Includes the latest ingest handshake, reconnect, and connection diagnostics fixes.
- Keeps the **What's New** and **CHECK FOR UPDATES** release flow.
- Version, installer, and release metadata are synchronized to 1.0.12.

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
