# HornyGrail Mobile App

Private Capacitor + SvelteKit mobile client for browsing and uploading HornyGrail media.

## Implemented MVP

- Private build-time config from `mobile.private.json`.
- Randomized browse feed backed by `GET /api/browse/random`.
- Single media detail route at `/image/[id]`.
- Image and WebM selection from the WebView file picker.
- SHA-256 duplicate detection over original bytes.
- Integrity checks through `GET /api/assets/{id}/integrity`.
- Presigned original and thumbnail uploads through `POST /api/uploads/sign`.
- Metadata registration through `POST /api/`.
- Per-file upload states with retry, repair, cancellation, and duplicate outcomes.
- Android Capacitor shell with a native `HornyGrailMedia` thumbnail plugin.

## Stack

- Web layer: SvelteKit static app
- Mobile shell: Capacitor
- Primary target: Android
- Video thumbnailing: native Android media decoder through a Capacitor bridge

The Android plugin keeps WebM thumbnailing out of browser/video-canvas capture on mobile. It currently uses Android `MediaMetadataRetriever` instead of bundling ffmpeg, which avoids introducing an unreviewed binary and license surface. If strict ffmpeg parity is required later, keep the same `HornyGrailMedia.createVideoThumbnail` bridge and replace the plugin internals after the ffmpeg licensing decision.

## Private Config

Tracked example:

```text
mobile.private.example.json
```

Create the real private file at:

```text
mobile.private.json
```

Expected shape:

```json
{
  "apiBaseUrl": "https://your-api-id.execute-api.your-region.amazonaws.com/api",
  "cloudFrontBaseUrl": "https://your-cloudfront-domain.cloudfront.net",
  "writeApiKey": "replace-with-write-api-key"
}
```

`npm run dev`, `npm run build`, and `npm run cap:sync` generate `src/lib/generated/privateConfig.js` from that private file before starting.

## Commands

```bash
npm install
npm run dev
npm run build
npm run cap:sync
npm run cap:open:android
```

Android Gradle builds require either `ANDROID_HOME` or `android/local.properties` with `sdk.dir` pointing at a local Android SDK. On this workstation the SDK was available at `C:\Users\super\AppData\Local\Android\Sdk`.

## Native Thumbnail Bridge

The web layer calls:

```js
HornyGrailMedia.createVideoThumbnail({
  sourceDataUrl,
  sourcePath,
  mimeType: 'video/webm',
  maxDimension: 320,
  quality: 90
});
```

The Android implementation accepts either `sourcePath` or `sourceDataUrl` and returns:

```json
{
  "thumbnailBase64": "..."
}
```

`sourceDataUrl` is used by the current WebView file-picker flow. `sourcePath` is supported for a future native file-picker bridge that avoids base64 transfer for large videos.
