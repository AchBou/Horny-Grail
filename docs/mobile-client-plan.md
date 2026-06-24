# Mobile Client Plan

This plan assumes the mobile client is a private uploader/viewer for the project owner only. It is not intended for public distribution through app stores or for use by untrusted users.

## Goals

- Browse existing images and videos from the current public read API.
- Upload originals and thumbnails through backend-issued presigned URLs.
- Preserve the existing SHA-256 hash-based metadata and S3 object key contract.
- Keep the mobile implementation aligned with the desktop uploader contract in `docs/upload-contract.md`.

## Non-Goals

- Public user accounts.
- Multi-user authorization.
- Public app-store distribution.
- Direct AWS SDK access from the mobile client.
- Changing S3 key formats or DynamoDB identifiers.

## Recommended MVP

1. Configure API base URL, CloudFront base URL, and write API key through private build-time configuration.
2. Browse randomized media using `GET /api/browse/random`.
3. View a single item by hash using `GET /api/{id}` and CloudFront media URLs.
4. Select a local image or WebM file.
5. Compute SHA-256 over original bytes.
6. Check `GET /api/assets/{id}/integrity`.
7. Upload missing original and thumbnail assets through `POST /api/uploads/sign` and S3 `PUT`.
8. Register metadata through `POST /api/`.
9. Show clear upload status, retry errors, and duplicate/repair outcomes.

## Private Secret Handling

The current `WRITE_API_KEY` model is acceptable only because this client is private and not distributed.

Rules:

- Do not commit mobile `.env`, generated config, keystores, provisioning files, or local secret files.
- Use private build-time configuration for the write key.
- Keep generated build config outside tracked source files when it contains secrets.
- Treat every installed build as trusted but extractable. If the app is ever shared, replace the write API key model first.

## Build-Time Config Shape

Use one private config object for the mobile app build:

```json
{
  "apiBaseUrl": "https://your-api-id.execute-api.your-region.amazonaws.com/api",
  "cloudFrontBaseUrl": "https://your-cloudfront-domain.cloudfront.net",
  "writeApiKey": "replace-with-write-api-key"
}
```

Config rules:

- `apiBaseUrl` must include the `/api` suffix
- `cloudFrontBaseUrl` must be the public distribution base URL without a trailing slash
- `writeApiKey` is required only because this mobile client is private

Recommended file contract:

- Tracked example file: `local/mobile-app/mobile.private.example.json`
- Untracked real file: `local/mobile-app/mobile.private.json`

If the mobile app is built with framework-specific env files, keep the same three keys and map them into the app at build time:

- `MOBILE_API_BASE_URL`
- `MOBILE_CLOUDFRONT_BASE_URL`
- `MOBILE_WRITE_API_KEY`

Preferred loading rule:

- Load the private build-time config once during app startup
- Fail fast if any required key is missing
- Keep config parsing centralized in one module rather than reading env values throughout the app

## API Dependencies

Read endpoints:

- `GET /api/browse/random?limit=<n>&cursor=<opaque-cursor>`
- `GET /api/get-random-image`
- `GET /api/{id}`

Upload and repair endpoints:

- `GET /api/assets/{id}/integrity`
- `POST /api/uploads/sign`
- `POST /api/`

Use `docs/mobile-api-reference.md` as the client-facing endpoint reference. Use `docs/upload-contract.md` for upload validation rules, MIME types, and size limits.

Required upload header:

```http
x-api-key: <write-api-key>
```

The full upload request body, MIME type rules, size limits, and object keys are defined in `docs/upload-contract.md`.

## Upload Flow

1. Read the selected original file as bytes.
2. Compute SHA-256 and use it as canonical `id`.
3. Detect extension and exact MIME type.
4. Call asset integrity endpoint.
5. If metadata and both assets exist, skip as duplicate.
6. If original is missing, request a signed URL for `files/<hash>.<ext>` and upload original bytes.
7. Generate a JPEG thumbnail.
8. If thumbnail is missing, request a signed URL for `thumbnails/thumbnail-<hash>.jpeg` and upload thumbnail bytes.
9. Register metadata with `{ "id": "<hash>", "ext": "<original-ext>" }`.
10. Recheck integrity after upload failures before retrying, so partial success can be repaired.

## Thumbnail Requirements

- Thumbnails must be JPEG.
- Thumbnail key must be `thumbnails/thumbnail-<hash>.jpeg`.
- Thumbnail upload request must use:

```json
{
  "path": "thumbnails",
  "ext": "jpeg",
  "contentType": "image/jpeg"
}
```

Mobile MVP decisions:

- Support WebM uploads in the first mobile version.
- Generate WebM thumbnails natively, not through browser/video-canvas capture in the MVP.
- Keep generated thumbnails below the backend thumbnail size limit.

Chosen implementation:

- Use a native path for WebM thumbnail generation on mobile.
- The current Android MVP uses `MediaMetadataRetriever` through the `HornyGrailMedia` Capacitor plugin instead of bundling ffmpeg.
- Keep the bridge boundary stable so the plugin internals can be replaced with an ffmpeg-backed implementation after licensing and binary distribution are reviewed.
- Capture a single representative frame and encode it as JPEG before upload.
- Reuse the desktop rule that video thumbnailing should stay outside the web layer because browser media events are the fragile part.
- Treat JavaScript or WebView thumbnail generation as a last-resort fallback only after the native path exists and is proven necessary.

Platform notes:

- If the mobile client is built with Capacitor, implement the thumbnail step in a custom native plugin or a maintained ffmpeg plugin rather than in Svelte code.
- If the mobile client is built with React Native or native Android/iOS, keep thumbnail generation entirely in the native layer and pass back JPEG bytes or a temporary file path.
- Keep the generated JPEG bounded so it remains under the backend thumbnail upload size limit.
- Review ffmpeg licensing before bundling it into any installable mobile build.

## Chosen Stack

- Mobile shell: Capacitor
- Web layer: SvelteKit static app
- Primary mobile target: Android first

Why this stack:

- It keeps the project aligned with the existing Svelte codebase.
- It minimizes duplicated API and upload logic.
- It still leaves file access, hashing, and WebM thumbnail generation available through native bridges.
- It is enough for the current private-client scope without committing to a heavier native stack.

Scaffold location:

- `local/mobile-app`

Defer reconsidering the stack unless the app later needs sustained background transfers, complex media pipelines, or platform-specific UX that becomes awkward in Capacitor.

## Reliability Requirements

Mobile uploads should assume unreliable network and app suspension.

Implement:

- Retry with backoff for API calls.
- Retry S3 `PUT` only after checking current asset integrity.
- Clear per-file states: pending, hashing, duplicate, uploading original, thumbnailing, uploading thumbnail, registering metadata, complete, failed.
- Safe cancellation between stages.
- A repair action for files where metadata exists but one S3 object is missing.

## Backend Tasks Before Build

- Add concise API documentation for the mobile endpoints.
- Standardize backend error response shapes enough for mobile UI messages.
- Remove or reduce noisy full-event production logs in write handlers.
- No DynamoDB backfill is needed while the production table is still empty. If data is imported later, every item must include `status` and `randomKey`.

## First Implementation Milestone

Build a private mobile MVP with:

- Local configuration screen.
- Browse screen.
- Single media detail screen.
- Image and WebM upload from gallery/files.
- SHA-256 duplicate detection.
- Presigned original and thumbnail upload.
- Metadata registration.
- Basic retry and repair handling.

Defer background uploads, app-store packaging, and account-based auth until the private upload flow is reliable.
