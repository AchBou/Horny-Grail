# Mobile API Reference

This document describes the backend endpoints the private mobile client should use today. It is intentionally concise and matches the current handlers in `serverless/horny-grail-app/`.

Base URL:

```text
https://<api-id>.execute-api.<region>.amazonaws.com/api
```

## Conventions

- Canonical image/video identifier: `id`
- `id` must be a 64-character hex SHA-256 string
- Public reads do not require authentication
- Write endpoints require:

```http
x-api-key: <write-api-key>
```

- Media is served from CloudFront, not from these API endpoints directly
- All non-2xx JSON error responses now use:

```json
{
  "code": "bad_request",
  "message": "Human-readable explanation"
}
```

- The mobile client should branch on HTTP status first, then use `code` for stable logic and `message` for UI text

## GET `/browse/random`

Returns one randomized browse page.

Query parameters:

- `limit`
  Allowed range: `1` to `48`
  Default: `24`
- `cursor`
  Opaque cursor returned by the previous page

Example request:

```http
GET /api/browse/random?limit=24
```

Successful response:

```json
{
  "items": [
    {
      "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "ext": "jpg",
      "status": "active",
      "randomKey": 0.8
    }
  ],
  "seed": 0.75,
  "cursor": "opaque-cursor",
  "wrapped": false,
  "hasMore": true
}
```

Notes:

- `cursor` must be treated as opaque and passed back unchanged
- `wrapped: true` means the query wrapped from the higher random segment back to the lower one
- `items` currently include backend fields such as `status` and `randomKey`; the mobile client should only depend on `id` and `ext`

Common failures:

- `400` invalid `limit`
- `400` invalid `cursor`
- `405` non-`GET` request
- `500` browse failure

## GET `/get-random-image`

Returns one random active item and its public CloudFront file URL.

Example request:

```http
GET /api/get-random-image
```

Successful response:

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ext": "jpg",
  "url": "https://example.cloudfront.net/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg"
}
```

Common failures:

- `404` no active items
- `405` non-`GET` request
- `500` lookup failure

## GET `/{id}`

Returns metadata for one item by canonical hash.

Example request:

```http
GET /api/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Successful response:

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ext": "jpg",
  "date": "2026-06-24T18:00:00.000Z",
  "status": "active",
  "randomKey": 0.42
}
```

If the item does not exist, the current handler returns:

```json
null
```

Common failures:

- `400` invalid `id`
- `405` non-`GET` request
- `500` lookup failure

Client note:

- Build the public original URL as `files/<id>.<ext>` under the configured CloudFront base URL
- Build the public thumbnail URL as `thumbnails/thumbnail-<id>.jpeg` under the configured CloudFront base URL

## GET `/assets/{id}/integrity`

Checks whether metadata, original, and thumbnail all exist.

Example request:

```http
GET /api/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/integrity
```

Response when everything exists:

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "metadataExists": true,
  "originalExists": true,
  "thumbnailExists": true,
  "repairRequired": false,
  "missing": [],
  "item": {
    "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "ext": "jpg"
  }
}
```

Response when metadata does not exist:

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "metadataExists": false,
  "originalExists": false,
  "thumbnailExists": false,
  "repairRequired": false,
  "missing": []
}
```

Response when repair is needed:

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "metadataExists": true,
  "originalExists": true,
  "thumbnailExists": false,
  "repairRequired": true,
  "missing": ["thumbnail"],
  "item": {
    "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "ext": "png"
  }
}
```

Common failures:

- `400` invalid `id`
- `405` non-`GET` request
- `500` integrity check failure

## POST `/uploads/sign`

Issues a presigned S3 upload URL for either an original file or a JPEG thumbnail.

Required headers:

```http
Content-Type: application/json
x-api-key: <write-api-key>
```

Required JSON body:

```json
{
  "path": "files",
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ext": "webm",
  "sizeBytes": 98765,
  "contentType": "video/webm"
}
```

Successful response:

```json
{
  "uploadUrl": "https://example.com/upload",
  "key": "files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webm",
  "headers": {
    "Content-Type": "video/webm"
  }
}
```

Client rules:

- Use `path: "files"` for originals
- Use `path: "thumbnails"` for thumbnails
- Thumbnails must use `ext: "jpeg"` and `contentType: "image/jpeg"`
- Include every returned header exactly in the following S3 `PUT`

For the full supported extension list, MIME rules, and size limits, use `docs/upload-contract.md`.

Common failures:

- `400` invalid body, `id`, extension, MIME type, or size
- `401` missing or incorrect API key
- `405` non-`POST` request
- `500` signing failure

## POST `/`

Registers or updates metadata after original and thumbnail uploads succeed.

Required headers:

```http
Content-Type: application/json
x-api-key: <write-api-key>
```

Required JSON body:

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ext": "webm"
}
```

Successful response:

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ext": "webm",
  "date": "2026-06-24T18:00:00.000Z",
  "status": "active",
  "randomKey": 0.42
}
```

Notes:

- The backend sets `status: "active"`
- The backend generates `randomKey`
- The client should treat the returned `date` and `randomKey` as informational

Common failures:

- `400` invalid JSON, `id`, or extension
- `401` missing or incorrect API key
- `405` non-`POST` request
- `500` metadata write failure

## Standard Error Examples

Bad request:

```json
{
  "code": "bad_request",
  "message": "Invalid image id"
}
```

Unauthorized:

```json
{
  "code": "unauthorized",
  "message": "Unauthorized"
}
```

Not found:

```json
{
  "code": "not_found",
  "message": "No active images found"
}
```

Server error:

```json
{
  "code": "internal_server_error",
  "message": "Failed to create upload URL"
}
```

## Recommended Mobile Upload Sequence

1. Compute SHA-256 and use it as `id`
2. Call `GET /assets/{id}/integrity`
3. If metadata and both assets already exist, skip as duplicate
4. If the original is missing, call `POST /uploads/sign` and upload the original to S3
5. If the thumbnail is missing, generate a JPEG thumbnail, call `POST /uploads/sign`, and upload the thumbnail to S3
6. Call `POST /` with `{ "id": "<hash>", "ext": "<original-ext>" }`
7. On failures after any upload, call the integrity endpoint again before retrying so partial successes can be repaired cleanly
