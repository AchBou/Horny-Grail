# HornyGrail Mobile App

Private Capacitor + SvelteKit mobile client for browsing and uploading HornyGrail media.

## Current UX

- The home screen is a neutral chooser, not a gallery-first or upload-first screen.
- Users must enter the shared access code before browsing or opening saved media.
- Users explicitly choose `Browse Grail` or `Upload Media` on entry.
- The randomized gallery is loaded only after the user opens browse mode.
- Upload UI and queue details stay hidden until the user opens upload mode or resumes an active queue.

## Implemented MVP

- Private build-time config from `mobile.private.json`.
- Shared-code unlock flow backed by `POST /auth/mobile/session`.
- Chooser-first home screen with explicit browse and upload entry points.
- Randomized browse feed backed by authenticated `GET /api/mobile/browse/random`.
- Single media detail route at `/image/[id]`.
- Native Android media selection preserves eligible MediaStore URIs for optional system-confirmed deletion after upload; web builds use the standard file picker.
- SHA-256 duplicate detection over original bytes.
- Browse/detail integrity checks through authenticated `GET /api/mobile/assets/{id}/integrity`.
- Upload integrity checks through `GET /api/assets/{id}/integrity` with the write API key.
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
  "writeApiKey": "replace-with-write-api-key"
}
```

`npm run dev`, `npm run build`, and `npm run cap:sync` generate `src/lib/generated/privateConfig.js` from that private file before starting.

The app now expects the user to enter the shared access code on first launch or after the 1-hour mobile read session expires. After unlock, read requests carry a short-lived bearer token and the backend returns signed media URLs instead of relying on a public asset base URL.

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

The native picker uses `sourcePath` so video thumbnailing avoids a base64 transfer for newly selected files. The standard WebView picker continues to use `sourceDataUrl`.
