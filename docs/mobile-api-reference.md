# Mobile API Reference

The endpoints the private mobile app (`local/mobile-app/`) calls. Handlers live in `serverless/horny-grail-app/`; the route tables are in `src/functions/*.mjs`.

Base URL (the `apiBaseUrl` in `mobile.private.json`):

```text
https://<api-id>.execute-api.<region>.amazonaws.com/api
```

## Conventions

- `id` is the file's SHA-256 as 64 hex characters.
- Every call except login sends the session from `POST /auth/mobile/session`:

```http
Authorization: Bearer <token>
```

- The app holds no permanent key. A `401` means the session expired or the vault was locked: show the unlock screen; the upload queue pauses until the next login.
- Errors are JSON with a stable `code` and a display `message`. Branch on the HTTP status, then on `code`:

```json
{ "code": "bad_request", "message": "Invalid image id" }
```

## POST `/auth/mobile/session`

Exchanges the passphrase for a 1-hour session. The passphrase is case-insensitive and ignores extra spaces.

```http
POST /auth/mobile/session
Content-Type: application/json

{ "code": "four random words here" }
```

```json
{ "token": "<payload>.<signature>", "expiresAt": 1795598353 }
```

Failures:

- `401` wrong passphrase
- `429` logins paused after too many wrong attempts (from anyone); `Retry-After` gives the seconds left
- `503` the login limiter is unavailable, so logins fail closed

## GET `/mobile/browse/random`

One page of a per-session shuffle. Query: `limit` (1 to 48, default 24) and `cursor` from the previous page.

```json
{
  "items": [
    {
      "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "ext": "jpg",
      "fileUrl": "https://<bucket>.s3.<region>.amazonaws.com/files/...?X-Amz-...",
      "thumbnailUrl": "https://<bucket>.s3.<region>.amazonaws.com/thumbnails/...?X-Amz-..."
    }
  ],
  "seed": "3f9c1a07b2e4d815",
  "cursor": "opaque-cursor",
  "hasMore": true
}
```

- Treat `cursor` as opaque. A request without one starts a new shuffle; paging through it shows every item exactly once, even if uploads happen meanwhile.
- `fileUrl` and `thumbnailUrl` are presigned and expire after `MobileSignedUrlTtlSeconds` (15 minutes by default). Fetch the page again for fresh URLs.
- Failures: `400` invalid `limit` or `cursor`, `401`.

## GET `/mobile/{id}`

One item with presigned `fileUrl` and `thumbnailUrl`, in the same shape as a browse item. Failures: `400` invalid `id`, `401`, `404` no such item.

## GET `/assets/{id}/integrity`

Whether the metadata, the original and the thumbnail exist. Used before uploading (duplicates) and to repair partial uploads.

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "metadataExists": true,
  "originalExists": true,
  "thumbnailExists": false,
  "repairRequired": true,
  "missing": ["thumbnail"],
  "item": { "id": "aaaa...", "ext": "png" }
}
```

When nothing is registered, `metadataExists` is `false`, `missing` is empty and there is no `item`.

## POST `/uploads/sign`

A presigned S3 `PUT` URL for an original or a thumbnail.

```json
{
  "path": "files",
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ext": "webm",
  "sizeBytes": 98765,
  "contentType": "video/webm"
}
```

```json
{
  "uploadUrl": "https://<bucket>.s3.<region>.amazonaws.com/files/aaaa....webm?X-Amz-...",
  "key": "files/aaaa....webm",
  "headers": {
    "Content-Type": "video/webm",
    "x-amz-checksum-sha256": "<the id as base64>"
  }
}
```

- `path` is `files` for originals and `thumbnails` for thumbnails; thumbnails use `ext: "jpeg"` and `contentType: "image/jpeg"`.
- Send every returned header unchanged with the `PUT`. For originals, S3 rejects a body whose SHA-256 is not the `id`.
- Extensions, MIME types and size limits: `docs/upload-contract.md`.
- Failures: `400` invalid body, `401`.

## POST `/`

Registers an item once its original and thumbnail are both in S3.

```json
{ "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ext": "webm" }
```

Returns the stored item (`id`, `ext`, `date`, `status`, `randomKey`). Registering an existing id returns it unchanged.

Failures:

- `400` invalid `id` or `ext`, or the id is already registered with another extension
- `401`
- `409` a file is missing, with `"missing": ["original"]`, `["thumbnail"]` or both; upload it, then register again

## Upload sequence

1. Hash the file; the SHA-256 is the `id`.
2. `GET /assets/{id}/integrity`. If the metadata and both files exist, it is a duplicate.
3. Upload whatever is missing: `POST /uploads/sign`, then `PUT` to S3 with the returned headers. Do the original, then the thumbnail.
4. `POST /` with `{ id, ext }`.
5. After a failure, check integrity again before retrying, so a half-finished upload is completed rather than restarted.
