# HornyGrail Status And Backlog

This document reflects the current implemented state of the project plus the main follow-up work that still appears open.

## Implemented

Architecture and data contract:

- [x] Consolidated the active backend into `serverless/horny-grail-app/`
- [x] Consolidated active private clients into `local/mobile-app/` and `local/desktop-app/`
- [x] Standardized on SHA-256 `id` as the canonical media identifier
- [x] Standardized original object keys as `files/<hash>.<ext>`
- [x] Standardized thumbnail object keys as `thumbnails/thumbnail-<hash>.jpeg`
- [x] Moved client and backend configuration to explicit env or private config files

Frontend:

- [x] Public SvelteKit frontend for browse, random item, and single-item detail
- [x] Cursor-based randomized infinite scroll backed by `GET /api/browse/random`
- [x] Opens on Browse; items open in a full-screen viewer over the grid (←/→, swipe, Back keeps filter, order and scroll)
- [x] Random in the same viewer, following the tag filter (`GET /api/browse/random` without a cursor)
- [x] Denser grid, header menu, video controls on every video
- [x] Discreet mode (neutral tab title and icon) and Hide (B key blanks the page)
- [x] Playwright tests on the mock gallery: filters, viewer, Back, direct links, Random by tag, discreet mode, Hide, phone swipe
- [x] Static SPA build for S3 + CloudFront deployment
- [x] Automated frontend deployment workflow in GitHub Actions
- [x] Improved error states and recovery UX across browse, random, and detail flows
- [x] Added a dedicated 404 and missing-route experience

Desktop app:

- [x] Tauri 2 desktop uploader with folder watch flow
- [x] Native SHA-256 hashing through `compute_sha256_streaming`
- [x] Duplicate detection by metadata lookup on canonical `id`
- [x] Asset integrity checks and repair flow
- [x] Native image thumbnail generation
- [x] Native WebM thumbnail generation with ffmpeg fallback behavior
- [x] Manual thumbnail regeneration for existing files

Mobile app:

- [x] Capacitor + SvelteKit private mobile client
- [x] Chooser-first home screen with explicit browse and upload modes
- [x] On-demand randomized browse instead of loading browse content immediately on app entry
- [x] Duplicate-aware upload queue with retry, cancel, and repair behavior
- [x] Android-native WebM thumbnail bridge through `HornyGrailMedia`
- [x] Item detail view with integrity visibility

Backend:

- [x] SAM-managed DynamoDB metadata table
- [x] `RandomImageIndex` on `status` and `randomKey`
- [x] Passphrase-protected read endpoints for single item, random item, and randomized browse (web cookies, mobile session)
- [x] Write endpoints accept the desktop `x-api-key` or a mobile session; uploads are checksum-verified by S3
- [x] Three routed Lambdas (auth, read, write) with secrets read at runtime
- [x] Presigned S3 upload signing for originals and thumbnails
- [x] Asset integrity endpoint for repair-aware clients
- [x] Input validation for ids, extensions, MIME types, and upload size limits

Tags and library:

- [x] Free-form tags on items, set from the desktop only (upload rows, batch tags, Watch tab)
- [x] Desktop Watch tab: shuffled feed from the Grail, tag filters, full viewer with quick tagging
- [x] Tag-filtered browse (`tags=a,b`, `untagged=1`) with tag counts, read-only on the phone and the website
- [x] Phone app rebuilt with tags and Capacitor 8.6.2

Delete from the Grail:

- [x] Desktop-only delete (upload list and Watch viewer) with Undo; deleted items are hidden everywhere
- [x] Recently deleted view in the Watch tab: restore with tags for 30 days, then gone for good (DynamoDB TTL + bucket versioning)

No duplicates on devices:

- [x] Phone: delete uploaded media from the phone once saved
- [x] Desktop: move uploaded files to the Recycle Bin once the Grail confirms them (re-hashed first)
- [x] Tests for upload, duplicate detection, repair and the delete-from-device rules (desktop `npm run test`, phone `npm run test`, Rust `cargo test --lib`)
- [x] Quieter desktop logging: no per-event or per-upload logs, errors logged once

Security and operations:

- [x] Rate-limited passphrase logins with a global lockout
- [x] Desktop window CSP limiting scripts, media and network sources
- [x] Lockfiles tracked; CI runs check and unit tests before every website deploy
- [x] Backups: upload bucket versioning (deleted or replaced files kept 30 days), point-in-time recovery and deletion protection on the metadata table
- [x] Backend functions bundled with esbuild (small packages, fast deploys and cold starts)

Documentation:

- [x] Shared upload contract for desktop and mobile
- [x] Mobile API reference
- [x] Frontend deployment notes
- [x] Desktop ffmpeg and thumbnail-generation notes
- [x] Repo-level architecture and workflow overview

## Priorities For A Mostly Solo / Private-Uploader Setup

This priority order assumes uploads are mainly done by you through the private desktop or mobile clients, while the public frontend remains internet-facing for browsing.

## Do Next

- [ ] Add broader backend test coverage around route behavior and deployment-sensitive config
- [ ] Add staging or environment-specific config strategy beyond local examples and production values
- [ ] Add rollback guidance for backend and client deployments so production changes are reversible
- [ ] Move to SvelteKit 3 once it has matured (needs Node 22.17+ and TypeScript 6)

## Important Soon

- [ ] Add richer metadata, navigation polish, and non-hash-facing UX where appropriate
- [ ] Expand verification on real devices beyond the current Android-first path
- [ ] Standardize error handling and logging more strictly across every handler

## Later Hardening

- [ ] Add rate limiting for authenticated writes (logins are already limited, reads sit behind signed cookies)
- [ ] Replace the shared client-held write API key with a stronger write-auth strategy if private upload clients are ever distributed beyond your own devices
- [ ] Add a clearer logging and monitoring strategy across backend and clients
- [ ] Document monitoring, alerting, and operational runbooks
- [ ] Decide whether smaller or per-platform ffmpeg bundles are needed
- [ ] Revisit whether the chooser screen should remain minimal or become more branded
