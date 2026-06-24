# Shared Upload Contract

This contract applies to desktop and mobile upload clients. Clients never write AWS directly with credentials; they request backend-issued presigned S3 URLs, then upload bytes to those URLs.

## Supported Originals

Original uploads use the SHA-256 content hash as `id` and are stored at:

```text
files/<hash>.<ext>
```

Supported original extensions and MIME types:

| Extension | MIME type |
| --- | --- |
| `jpg`, `jpeg` | `image/jpeg` |
| `png` | `image/png` |
| `gif` | `image/gif` |
| `webp` | `image/webp` |
| `bmp` | `image/bmp` |
| `tif`, `tiff` | `image/tiff` |
| `webm` | `video/webm` |

Maximum original size: `104857600` bytes.

## Supported Thumbnails

Thumbnail uploads are always JPEG and are stored at:

```text
thumbnails/thumbnail-<hash>.jpeg
```

Thumbnail sign requests must use:

| Field | Value |
| --- | --- |
| `path` | `thumbnails` |
| `ext` | `jpeg` |
| `contentType` | `image/jpeg` |

Maximum thumbnail size: `2097152` bytes.

## Sign Request

`POST /api/uploads/sign`

Required headers:

```http
Content-Type: application/json
x-api-key: <write-api-key>
```

Required JSON body:

```json
{
  "path": "files",
  "id": "64-character lowercase-or-uppercase-hex-sha256",
  "ext": "png",
  "sizeBytes": 123456,
  "contentType": "image/png"
}
```

Validation rules:

- `path` must be `files` or `thumbnails`.
- `id` must be a 64-character hex SHA-256 content hash.
- `ext` must be one of the supported extensions above.
- `contentType` must exactly match the extension, except thumbnails are always `image/jpeg`.
- `sizeBytes` must be a positive safe integer and must not exceed the relevant max size.

Successful response:

```json
{
  "uploadUrl": "https://...",
  "key": "files/<hash>.png",
  "headers": {
    "Content-Type": "image/png"
  }
}
```

Clients must include every returned header exactly on the subsequent `PUT` to `uploadUrl`.
Clients must upload the same bytes counted in `sizeBytes`; browser-style HTTP stacks usually set `Content-Length` automatically and should not be asked to set it manually.

## Upload Sequence

1. Compute SHA-256 over the original file bytes.
2. Check existing metadata by `id`; skip or repair existing assets as appropriate.
3. Request a sign URL for the original with exact byte length and MIME type.
4. `PUT` the original bytes to `uploadUrl` with the returned headers.
5. Generate a JPEG thumbnail.
6. Request a sign URL for the thumbnail with exact byte length and `image/jpeg`.
7. `PUT` thumbnail bytes to `uploadUrl` with the returned headers.
8. Register metadata with `POST /api` using `{ "id": "<hash>", "ext": "<original-ext>" }`.

Keep the hash-based object keys unchanged. Duplicate detection, random browse, image rendering, and repair tooling all depend on the current `files/` and `thumbnails/` layout.
