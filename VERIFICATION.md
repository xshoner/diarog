# Companion 0.2.0 verification

## Findings

- On 2026-09-20, `origin/main` and production `/api/version` both reported `7123f673b1dbf737359b3cdb1c275caf3791b378`. The previous merge was deployed.
- The official Korean model URL returned HTTP 200; the complete 86,914,329-byte ZIP matched the pinned SHA-256 `eea36124087fed26c59996a4761519458e3bd185e8ea9d9865ad8760c4a1d989`.
- The old app used one message for download, transcription and synchronization. A sync could overwrite download progress/errors. Saved credentials were incorrectly labelled as a current connection.
- An unmetered network constraint can leave a download waiting on a metered Wi-Fi/hotspot. The app now exposes worker state and offers an explicit mobile-data download option.
- Health Connect previously reported collection completed even when all three days returned no data.
- Diary edits saved style examples but did not refresh personal memories. Memory database errors were previously ignored.

## Changes

- Separate persistent diagnostics for model, connection, transcription, uploads, last successful audio summary and location; explicit Health Connect data/permission status.
- Blue pulse only after a server response, expires after 90 seconds, refreshed every 30 seconds while the app is visible. Authentication rejection disables collection. The web shows recent server contact and clears its live indicator on refresh failure.
- Download MB/percentage, checksum and native engine loading checks, useful error messages, bounded network retries, cancellation and network choice. Replacement workers serialize temporary-file access.
- Server capability response checks storage access and AI key presence; key presence is explicitly not presented as a successful AI inference.
- Persona page shows sources, correction counts and memories, supports retrying extraction from saved diaries and removing incorrect memories. Diary and weekly prompts use the latest user corrections; unedited AI prose is not treated as the user's writing style. This is contextual personalization, not model-weight training.

## Automated checks

Run from the repository root:

```sh
npm run test:companion
npm run test:persona
npm run lint
npm run build
node tests/persona-http.mjs
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

The server tests use local fixtures, never real diary contents or paid inference. Android tests cover first launch, queue recovery, audio math, URL validation, stale connection indicators and incomplete model installations. Android lint can report nonfatal SDK/dependency/style warnings.

The HTTP smoke test runs the production Next.js build against a local fixture and verifies the persona page, authenticated reads, cross-origin rejection and owner-scoped deletion. It caught an internal-host/public-host mismatch in the old origin check; the check now uses the request's public Host and protocol.

The 0.2.0 APK signature matches the existing workspace APK, permitting an in-place update. APK SHA-256: `9a09dbcd34648f14017e6512214f924c0ee06324a517e486deb9ca413974047c`.

## Phone acceptance checks still required

No physical Android device was attached to ADB during development. These are not covered by JVM tests:

1. Install the 0.2.0 APK over 0.1.0; check the visible version and retained token/folder settings.
2. Verify connection; the blue pulse must stop on failed authentication or offline verification. With this web release deployed, check the storage/AI configuration diagnostics.
3. Download the model on Wi-Fi. Observe MB/percentage, extraction, engine validation and `준비됨`. Test cancellation and retry. A sync must not replace this status.
4. Enable recording collection and process one authorized short Korean recording. Check transcription completion, audio summary server acknowledgement, and the matching record at `/companion`.
5. For historical recordings, enable the historical-recordings checkbox. New files wait at least two minutes; already processed files are skipped.
6. Check Health Connect read permission and actual step data separately. Samsung Health must share steps with Health Connect. Check foreground and background collection independently.
7. Start location collection and wait for an accepted location; service running alone is not proof of a saved sample. Stop it and verify the notification disappears.
8. Edit a diary, review `/persona`, generate a later diary and weekly review, and check writing preferences. Verify removing a memory excludes it from subsequent memory retrieval. Re-extracting its original diary can recreate it.

A web deployment does not update the installed Android APK. Both components need updating. No new database migration is required beyond existing migrations 0001–0004.
