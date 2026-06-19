# HornyGrail Desktop Uploader

Tauri desktop app for scanning a local folder, checking whether images already exist in backend metadata, and uploading originals plus thumbnails through server-issued presigned URLs.

## Configuration

Copy `.env.example` to `.env` and provide:

- `VITE_API_BASE_URL`
- `VITE_WRITE_API_KEY`

The desktop app no longer needs direct AWS credentials for S3 or DynamoDB access.

## Commands

```bash
npm install
npm run dev
npm run check
npm run tauri dev
npm run build
```
