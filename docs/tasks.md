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
- [x] Random single-item route backed by `GET /api/get-random-image`
- [x] Static SPA build for S3 + CloudFront deployment
- [x] Automated frontend deployment workflow in GitHub Actions

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
- [x] Public read endpoints for list, single item, random item, and randomized browse
- [x] Write endpoints protected by `x-api-key`
- [x] Presigned S3 upload signing for originals and thumbnails
- [x] Asset integrity endpoint for repair-aware clients
- [x] Input validation for ids, extensions, MIME types, and upload size limits

Documentation:

- [x] Shared upload contract for desktop and mobile
- [x] Mobile API reference
- [x] Frontend deployment notes
- [x] Desktop ffmpeg and thumbnail-generation notes
- [x] Repo-level architecture and workflow overview

## Priorities For A Mostly Solo / Private-Uploader Setup

This priority order assumes uploads are mainly done by you through the private desktop or mobile clients, while the public frontend remains internet-facing for browsing.

## Do Next

- [ ] Add stronger persistence or resume behavior if uploads are interrupted by suspension or process death
- [ ] Add targeted automated coverage for thumbnail generation, upload repair, and duplicate-detection flows
- [ ] Replace the placeholder frontend Playwright test with real browse, random, and item-detail coverage
- [ ] Add broader backend test coverage around route behavior and deployment-sensitive config
- [ ] Add staging or environment-specific config strategy beyond local examples and production values
- [ ] Add rollback guidance for backend and client deployments so production changes are reversible
- [ ] Add a safe delete, archive, or moderation workflow for uploaded media

## Important Soon

- [ ] Improve error states and recovery UX across browse, random, and detail flows
- [ ] Add a dedicated 404 or missing-item experience
- [ ] Add richer metadata, navigation polish, and non-hash-facing UX where appropriate
- [ ] Expand verification on real devices beyond the current Android-first path
- [ ] Standardize error handling and logging more strictly across every handler
- [ ] Reduce noisy console logging in upload and watch flows
- [ ] Backfill `status` and `randomKey` if legacy or imported metadata is ever loaded into production

## Later Hardening

- [ ] Add rate limiting or similar abuse controls for public read traffic and authenticated writes
- [ ] Replace the shared client-held write API key with a stronger write-auth strategy if private upload clients are ever distributed beyond your own devices
- [ ] Add a clearer logging and monitoring strategy across backend and clients
- [ ] Document monitoring, alerting, and operational runbooks
- [ ] Decide whether smaller or per-platform ffmpeg bundles are needed
- [ ] Revisit whether the chooser screen should remain minimal or become more branded
