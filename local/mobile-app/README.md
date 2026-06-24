# HornyGrail Mobile App

Private Capacitor + SvelteKit mobile client scaffold for browsing and uploading HornyGrail media.

## Stack Decision

- Web layer: SvelteKit static app
- Mobile shell: Capacitor
- Video thumbnailing: native ffmpeg-backed path, not WebView capture

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

`npm run dev` and `npm run build` generate `src/lib/generated/privateConfig.js` from that private file before starting.

## Commands

```bash
npm install
npm run dev
npm run build
npm run cap:sync
npm run cap:open:android
```

## Next Build Steps

1. Create `mobile.private.json` from the example file.
2. Install dependencies.
3. Add the Android platform with `npx cap add android`.
4. Implement file picking, hashing, integrity checks, and upload flow.
5. Add the native WebM thumbnail plugin or bridge.
